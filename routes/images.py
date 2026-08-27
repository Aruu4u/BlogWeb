import utils
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import database
import schemas
import models
import Oauth2 as oauth2

from repository import image
router= APIRouter(tags=['Images'])


@router.post(
    "/blogs/{id}/images",
    response_model=schemas.ImageResponse
)
def upload_image(
    id: int,
    image_data: schemas.ImageCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return image.upload_image(
        blog_id=id,
        image=image_data,
        current_user=current_user,
        db=db
    )


@router.delete("/images/{id}")
def delete_image(
    id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return image.delete_image(
        image_id=id,
        current_user=current_user,
        db=db
    )




