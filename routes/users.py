from repository import user
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import database
import Oauth2 as oauth2
import models
import schemas

router = APIRouter(
    prefix="/users",
    tags=["Users"]
)




@router.patch("/me",response_model=schemas.UserResponse)
def update_profile(
    profile: schemas.UpdateProfile,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)):

    return user.update_profile(
        profile,
        current_user,
        db
    )



@router.delete("/me")
def delete_user(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return user.delete_user(
        current_user,
        db
    )


@router.get("/me/blogs")
def my_blogs(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return user.my_blogs(
        current_user,
        db
    )


@router.get("/me/starred")
def my_starred(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(oauth2.get_current_user)
):

    return user.my_starred(
        current_user,
        db
    )

@router.get("/{id}", response_model=schemas.PublicUser)
def get_user(id: int,db: Session = Depends(database.get_db),currentuser:str=Depends(oauth2.get_current_user)):
    return user.get_user(id, db)
