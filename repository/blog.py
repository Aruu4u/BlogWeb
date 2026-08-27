from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

import models
import schemas
from sqlalchemy import func, distinct
import math

from fastapi import UploadFile
from supabase_client import supabase
from config import settings
import uuid
from urllib.parse import unquote

def get_all_blogs(
    db: Session,
    page: int = 1,
    limit:int = 10,
    search: str = "",
    sort: str = "newest",
    current_user=None
):
    limit = min(limit, 50)
    page = max(page, 1) # if anyone call negative page
    query = (
    db.query(
        models.Blogs,
            func.count(distinct(models.Stars.user_id)).label("star_count"),
            func.count(distinct(models.Comments.id)).label("comment_count"),
    )
    .outerjoin(
        models.Stars,
        models.Stars.blog_id == models.Blogs.id
    )
    .outerjoin(
        models.Comments,
        models.Comments.blog_id == models.Blogs.id
    )
    .options(
        joinedload(models.Blogs.owner),
        joinedload(models.Blogs.images)
    )
    .filter(models.Blogs.visibility == True)
    .group_by(models.Blogs.id)
    )

    search = search.strip()
    if search:
        query = query.filter(
            or_(
                models.Blogs.title.ilike(f"%{search}%"),
                models.Blogs.content.ilike(f"%{search}%")
            )
        )
    total = db.query(models.Blogs).filter(
        models.Blogs.visibility == True
    )

    if search:
        total = total.filter(
            or_(
                models.Blogs.title.ilike(f"%{search}%"),
                models.Blogs.content.ilike(f"%{search}%")
            )
        )

    total = total.count()

    if sort == "oldest":
        query = query.order_by(models.Blogs.created_at.asc())
    else:
        query = query.order_by(models.Blogs.created_at.desc())

    

    blogs = query.offset((page - 1) * limit).limit(limit).all()

    blog_list = []

    starred_ids = set()

    if current_user:
        starred_ids = {
        star.blog_id
        for star in db.query(models.Stars)
        .filter(models.Stars.user_id == current_user.id)
        .all()
    }
    print(current_user)
    print(starred_ids)

    for blog, star_count, comment_count in blogs:

        is_starred = blog.id in starred_ids

        blog_list.append({
            "id": blog.id,
            "title": blog.title,
            "content": blog.content,
            "thumbnail": blog.thumbnail,
            "visibility": blog.visibility,
            "created_at": blog.created_at,
            "owner": blog.owner,
            "images": blog.images,
            "star_count": star_count,
            "comment_count": comment_count,
            "is_starred": is_starred
        })
    pages = math.ceil(total / limit) if total else 1

    return {
        "blogs": blog_list,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
        "has_next": page < pages,
        "has_previous": page > 1
    }

def get_blog(id: int, db: Session,current_user=None):

    blog = db.query(models.Blogs).options(
        joinedload(models.Blogs.owner),  #why joinedload() -> without it , if there are 20 blogs , sqlalchemy runs 1 query for blogs 20 query for owner 20 queries for images , but with this it loads all the related data
        joinedload(models.Blogs.images)
    ).filter(
        models.Blogs.id == id
    ).first()

    if blog is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Blog not found"
        )

    star_count = db.query(models.Stars).filter(
    models.Stars.blog_id == blog.id
    ).count()

    comment_count = db.query(models.Comments).filter(
        models.Comments.blog_id == blog.id
    ).count()

    is_starred = False

    if current_user:
        is_starred = db.query(models.Stars).filter(
            models.Stars.blog_id == blog.id,
            models.Stars.user_id == current_user.id
        ).first() is not None

    return {
        "id": blog.id,
        "title": blog.title,
        "content": blog.content,
        "thumbnail": blog.thumbnail,
        "visibility": blog.visibility,
        "created_at": blog.created_at,
        "owner": blog.owner,
        "author/Owner_id":blog.author_id,
        "images": blog.images,
        "star_count": star_count,
        "comment_count": comment_count,
        "is_starred": is_starred
    }


def create_blog(
    blog: schemas.BlogCreate,
    current_user,
    db: Session
):
    

    new_blog = models.Blogs(
        title=blog.title,
        content=blog.content,
        visibility=blog.visibility,
        thumbnail=blog.thumbnail,
        author_id=current_user.id
    )

    db.add(new_blog)
    db.flush() # flush() ;- Because we need the generated blog ID before inserting images.
    for image in blog.images:
      
        db.add(
            models.BlogImages(
                blog_id=new_blog.id,
                image_url=image.image_url,
                display_order=image.display_order
            )
        )

    db.commit()

    return get_blog(
        id=new_blog.id,
        db=db,
        current_user=current_user
    )


def update_blog(
    id: int,
    updated_blog: schemas.BlogUpdate,
    current_user,
    db: Session
):

    blog = db.query(models.Blogs).filter(
        models.Blogs.id == id
    ).first()

    if blog is None:
        raise HTTPException(
            status_code=404,
            detail="Blog not found"
        )

    if blog.author_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized"
        )

    update_data = updated_blog.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(blog, key, value)

    db.commit()

    return get_blog(
        id=blog.id,
        db=db,
        current_user=current_user
    )


def delete_blog(
    id: int,
    current_user,
    db: Session
):

    blog = db.query(models.Blogs).filter(
        models.Blogs.id == id
    ).first()

    if blog is None:
        raise HTTPException(
            status_code=404,
            detail="Blog not found"
        )

    if blog.author_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized"
        )

    # Get all images belonging to this blog
    images = (
        db.query(models.BlogImages)
        .filter(models.BlogImages.blog_id == id)
        .all()
    )
    for image in images:

        # Example:
        # https://bmtyxjmrqqljvwcitauo.supabase.co/storage/v1/object/public/Blog_images/abc.png

        filename = image.image_url.split(
            f"/storage/v1/object/public/{settings.supabase_bucket}/"
            )[-1]

        filename = unquote(filename)

        print("Deleting from Supabase:", filename)

        result = supabase.storage.from_(
        settings.supabase_bucket
            ).remove([filename])

        print("SUPABASE DELETE RESULT:", result)

    for image in images:
        db.delete(image)

    db.delete(blog)

    db.commit()

    return {
        "message": "Blog deleted successfully"
    }


def upload_blog_image(
    id: int,
    images: UploadFile,
    current_user,
    db: Session
):

    blog = db.query(models.Blogs).filter(
        models.Blogs.id == id
    ).first()

    if blog is None:
        raise HTTPException(
            status_code=404,
            detail="Blog not found"
        )

    if blog.author_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized"
        )

    filename = f"{uuid.uuid4()}_{images.filename}"

    file_bytes = images.file.read()


    supabase.storage.from_(settings.supabase_bucket).upload(
        filename,
        file_bytes,
        {
            "content-type": images.content_type
        }
    )

    image_url = supabase.storage.from_(
        settings.supabase_bucket
    ).get_public_url(filename)

    new_image = models.BlogImages(
        blog_id=id,
        image_url=image_url,
        display_order=0
    )

    db.add(new_image)
    db.commit()
    db.refresh(new_image)

    return new_image


def upload_blog_images(
    id: int,
    images: list[UploadFile],
    current_user,
    db: Session
):
    print("========== UPLOAD START ==========")
    print("Blog ID:", id)
    print("Current user:", current_user)
    print("Images received:", images)

    
    blog = db.query(models.Blogs).filter(
        models.Blogs.id == id
    ).first()

    print("Blog found:", blog)
    if blog is None:
        raise HTTPException(
            status_code=404,
            detail="Blog not found"
        )

    if blog.author_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized"
        )

    uploaded_images = []

    current_order = (
        db.query(models.BlogImages)
        .filter(models.BlogImages.blog_id == id)
        .count()
    )

    print("Current order:", current_order)
    print("Number of images:", len(images))

    for image in images:
        print("---------- PROCESSING IMAGE ----------")
        print("Filename:", image.filename)
        print("Content type:", image.content_type)

        filename = f"{uuid.uuid4()}_{image.filename}"

        file_bytes = image.file.read()

        if not file_bytes:
                raise HTTPException(
                    status_code=400,
                    detail=f"Empty file: {image.filename}"
                )
        print("Uploading:", filename)
        print("Content type:", image.content_type)
        print("Size:", len(file_bytes))
        print("Bucket:", settings.supabase_bucket)

        result=supabase.storage.from_(settings.supabase_bucket).upload(
            filename,
            file_bytes,
            {
                "content-type": image.content_type
            }
        )
        print("UPLOAD SUCCESS")
        print("SUPABASE UPLOAD RESULT:", result)

        image_url = supabase.storage.from_(
            settings.supabase_bucket
        ).get_public_url(filename)

        print("UPLOADED:", filename)
        print("IMAGE URL:", image_url)
        current_order += 1

        new_image = models.BlogImages(
            blog_id=id,
            image_url=image_url,
            display_order=current_order
        )

        db.add(new_image)
        db.flush()

        uploaded_images.append(new_image)
        print("DB IMAGE CREATED:", new_image.id)

    db.commit()

    for image in uploaded_images:
        db.refresh(image)

    return uploaded_images