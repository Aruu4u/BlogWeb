from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import database
import models
import schemas
import Oauth2 as oauth2

from repository import star


router = APIRouter(
    tags=["Stars"]
)


@router.post(
    "/blogs/{id}/star",
    response_model=schemas.Message
)
def star_blog(
    id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return star.star_blog(
        blog_id=id,
        current_user=current_user,
        db=db
    )


@router.delete(
    "/blogs/{id}/star",
    response_model=schemas.Message
)
def remove_star(
    id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return star.remove_star(
        blog_id=id,
        current_user=current_user,
        db=db
    )