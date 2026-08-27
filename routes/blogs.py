from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import database
import schemas
import models
import Oauth2 as oauth2

from repository import blog

from fastapi import UploadFile, File

router = APIRouter(
    prefix="/blogs",
    tags=["Blogs"]
)


@router.get("", response_model=schemas.BlogListResponse) #user will only see output according to this schema though the repo function returns a lot of other fields
def get_all_blogs(
    page: int = 1,
    limit: int = 10,
    search: str = "",
    sort: str = "newest",
    db: Session = Depends(database.get_db),
    current_user: models.User | None = Depends( #using model.User coz get_current_user_optional fn returns SQLAlchemy object
        oauth2.get_current_user_optional
    )
):

    return blog.get_all_blogs( 
        db=db,
        page=page,
        limit=limit,
        search=search,
        sort=sort,
        current_user=current_user
    )



@router.get("/{id}", response_model=schemas.BlogResponse)
def get_blog(
    id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User | None = Depends(
        oauth2.get_current_user_optional
    )
):

    return blog.get_blog(
        id=id,
        db=db,
        current_user=current_user
    )


@router.post("", response_model=schemas.BlogResponse)
def create_blog(
    blog_data: schemas.BlogCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return blog.create_blog(
        blog=blog_data,
        current_user=current_user,
        db=db
    )


@router.patch("/{id}", response_model=schemas.BlogResponse)
def update_blog(
    id: int,
    updated_blog: schemas.BlogUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return blog.update_blog(
        id=id,
        updated_blog=updated_blog,
        current_user=current_user,
        db=db
    )


@router.delete("/{id}")
def delete_blog(
    id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return blog.delete_blog(
        id=id,
        current_user=current_user,
        db=db
    )




@router.post("/{id}/images/upload", response_model=list[schemas.BlogImageResponse])
def upload_blog_image(
    id: int,
    images: list[UploadFile] = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):
    print("ROUTE HIT")
    print("Received images:", images)
    return blog.upload_blog_images(
        id=id,
        images=images,
        current_user=current_user,
        db=db
    )