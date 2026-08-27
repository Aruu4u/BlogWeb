from fastapi import HTTPException
from sqlalchemy.orm import Session
import models
import schemas


def get_user(id: int, db: Session):

    user = db.query(models.User).filter(models.User.id == id).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found dsfds    "
        )

    return user




def update_profile(
        profile: schemas.UpdateProfile,
        current_user: models.User,
        db: Session
):

    data = profile.model_dump(exclude_unset=True) # pydantic object to python dict , and neglect none items

    for key, value in data.items():
        setattr(current_user, key, value)

    db.commit()
    db.refresh(current_user)

    return current_user



def delete_user(current_user: models.User,
                db: Session):

    db.delete(current_user)

    db.commit()

    return {
        "message":"Account deleted successfully"
    }



def my_blogs(current_user: models.User,
             db: Session):

    blogs = db.query(models.Blogs).filter(
        models.Blogs.author_id == current_user.id
    ).all()

    return blogs



def my_starred(current_user: models.User,
               db: Session):

    blogs = (
        db.query(models.Blogs)
        .join(models.Stars)
        .filter(models.Stars.user_id == current_user.id)
        .all()
    )
# Blogs.id    Blogs.title       Stars.user_id    Stars.blog_id
# ────────────────────────────────────────────────────────────
# 1           Python Basics          7                1
# 3           Redis Tutorial         7                3
# 2           FastAPI Guide          5                2
# 4           PostgreSQL             2                4
# 1           Python Basics          5                1

    return blogs