import utils
from fastapi import APIRouter,HTTPException,Depends,status
import schemas 
import models as model
from sqlalchemy.orm import Session
import database as orm
import utils
import Oauth2
router= APIRouter(tags=['Authentication'])


@router.post("/login")
def login(user_credential:schemas.Login, db:Session=Depends(orm.get_db)):
  
    user=db.query(model.User).filter(model.User.email==user_credential.email).first()

    if not user : 
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,detail="Invalid Email")
    if not utils.verifyPassword(user_credential.password , user.password):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,detail="Invalid Password")

    access_token =Oauth2.create_access_token(data={"user_id":user.id,"user_email":user.email})
    return {"token":access_token , "token_type":"Bearer"}

    




@router.post("/signup",response_model=schemas.SignUpResponse)
def signup(user:schemas.Signup , db:Session=Depends(orm.get_db)):
    print(user.password)
    print(len(user.password))

    user_ = db.query(model.User).filter(model.User.email == user.email).first()

    if user_:
        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )

    #hashpassword
    hashed_password=utils.hash(user.password)
    user.password=hashed_password


    created_user = model.User(
    username=user.email.split("@")[0],
    email=user.email,
    password=hashed_password)

    db.add(created_user)
    db.commit()
    db.refresh(created_user)
    return created_user


