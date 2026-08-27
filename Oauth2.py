
from datetime import datetime,timedelta,timezone
from jose import jwt, JWTError
from config import settings
import schemas
import database
from fastapi import Depends,HTTPException,status
import models as model
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordBearer




def create_access_token(data:dict):
    payload=data.copy()
    expire_time=datetime.now(timezone.utc)+timedelta(minutes=settings.access_token_expiration_minute)
    payload.update({"exp":expire_time})
    token=jwt.encode(payload,settings.secret_key,algorithm=settings.algorithm)
    return token



def verify_access_token(token:str,credential_exception):
    try:
        payload=jwt.decode(token,settings.secret_key,algorithms=[settings.algorithm])
        u_id:str=payload.get("user_id")
        u_email:str=payload.get("user_email")
        if u_id is None:
            raise credential_exception
        token_data=schemas.TokenData(id=u_id,email=u_email)

    except JWTError as e:
        print("JWTError: ",e)
        raise credential_exception
    
    return token_data

oauth2_schema=OAuth2PasswordBearer(tokenUrl="login")

def get_current_user(token:str=Depends(oauth2_schema),db:Session=Depends(database.get_db)):
    credential_Exception=HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Token",headers={"WWW-Authenticate":"Bearer"})  
    token= verify_access_token(token,credential_Exception)
    print(f"decoded token info -> id:{token.id} email:{token.email}")

    user=db.query(model.User).filter(model.User.id==token.id).first()

    print("User from DB:", user)

    return user # returning a  sql alchemy object so the data type of receiving variable should be model.User 

oauth2_optional = OAuth2PasswordBearer(
    tokenUrl="login",
    auto_error=False
)

def get_current_user_optional(
    token: str | None = Depends(oauth2_optional),
    db: Session = Depends(database.get_db)
):
    print("TOKEN:", token)
    # Guest user
    if token is None:
        return None

    credential_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid Token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = verify_access_token(token, credential_exception)

    user = db.query(model.User).filter(
        model.User.id == token_data.id
    ).first()

    if user is None:
        raise credential_exception

    return user