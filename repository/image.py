from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas

from supabase_client import supabase
from config import settings

def upload_image(
    blog_id: int,
    image: schemas.ImageCreate,
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

    if blog.author_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You can upload images only to your own blogs."
        )

    new_image = models.BlogImages(
        blog_id=blog_id,
        image_url=image.image_url,
        display_order=image.display_order
    )

    db.add(new_image)
    db.commit()
    db.refresh(new_image)

    return new_image






def delete_image(
    image_id: int,
    current_user,
    db: Session
):

    image = (
        db.query(models.BlogImages)
        .filter(models.BlogImages.id == image_id)
        .first()
    )

    if image is None:
        raise HTTPException(
            status_code=404,
            detail="Image not found"
        )

    blog = (
        db.query(models.Blogs)
        .filter(models.Blogs.id == image.blog_id)
        .first()
    )

    if blog.author_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized"
        )

    # URL example:
    # https://xxxxx.supabase.co/storage/v1/object/public/Blog_images/abc.jpg

    file_path = image.image_url.split(
        f"/storage/v1/object/public/{settings.supabase_bucket}/"
    )[1]

    supabase.storage.from_(settings.supabase_bucket).remove(
        [file_path]
    )

    db.delete(image)
    db.commit()

    return {
        "message": "Image deleted successfully"
    }