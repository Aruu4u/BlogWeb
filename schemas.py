from pydantic import BaseModel,EmailStr,ConfigDict,Field
from typing import Optional
from datetime import datetime


class Login(BaseModel):#login
    email:EmailStr
    password:str

class Signup(BaseModel): #signup
    email:EmailStr
    password:str

class SignUpResponse(BaseModel):
    id:int
    email:EmailStr
    model_config = {"from_attributes": True}



class UpdateProfile(BaseModel):
    username: Optional[str] = None
    bio: Optional[str] = None
    profile_image: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    profile_image: Optional[str] = None
    bio: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PublicUser(BaseModel):
    id: int
    username: str
    profile_image: Optional[str] = None
    bio: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenData(BaseModel):
    id:Optional[int]=None
    email:Optional[str]=None



class ImageCreate(BaseModel):
    image_url: str
    display_order: int


class ImageResponse(BaseModel):
    id: int
    blog_id:int
    image_url: str
    display_order: int

    model_config = ConfigDict(from_attributes=True)

class BlogOwner(BaseModel):
    id: int
    username: str
    profile_image: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class BlogCreate(BaseModel):
    title: str
    content: str
    visibility: bool
    thumbnail:Optional[str]
    images: list[ImageCreate] = []

class BlogUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    visibility: Optional[bool] = None

class BlogResponse(BaseModel):
    id: int
    title: str
    content: str
    visibility: bool
    created_at: datetime
    owner: BlogOwner
    images: list[ImageResponse] = []
    star_count: int
    comment_count: int
    is_starred: bool

    model_config = ConfigDict(from_attributes=True)

class BlogListResponse(BaseModel):
    blogs: list[BlogResponse]
    total: int
    page: int
    limit: int

class BlogImageResponse(BaseModel):
    id: int
    image_url: str
    display_order: int

    model_config = ConfigDict(from_attributes=True)

class Message(BaseModel):
    message: str