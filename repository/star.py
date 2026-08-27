from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import models

def star_blog(
    blog_id: int,
    current_user,
    db: Session
):

    blog = db.query(models.Blogs).filter(
        models.Blogs.id == blog_id
    ).first()

    if blog is None:
        raise HTTPException(
            status_code=404,
            detail="Blog not found"
        )

    already_starred = db.query(models.Stars).filter(
        models.Stars.user_id == current_user.id,
        models.Stars.blog_id == blog_id
    ).first()

    if already_starred:
        raise HTTPException(
            status_code=400,
            detail="You already starred this blog."
        )

    star = models.Stars(
        user_id=current_user.id,
        blog_id=blog_id
    )

    db.add(star)
    db.commit()

    return {
        "message": "Blog starred successfully."
    }


def remove_star(
    blog_id: int,
    current_user,
    db: Session
):

    star = db.query(models.Stars).filter(
        models.Stars.user_id == current_user.id,
        models.Stars.blog_id == blog_id
    ).first()

    if star is None:
        raise HTTPException(
            status_code=404,
            detail="Star not found."
        )

    db.delete(star)
    db.commit()

    return {
        "message": "Star removed successfully."
    }