from  fastapi import FastAPI 

import models    #IMPORT THE MODEL OF OUR TABLE
from database import engine # CONNECT SQLALCHMEY WITH DATABASE 

from routes.auth import router as auth
from routes.blogs import router as blogs
from routes.stars import router as stars
from routes.search import router as search
from routes.images import router as images
from routes.users import router as users


from fastapi.middleware.cors import CORSMiddleware

app=FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

models.Base.metadata.create_all(bind=engine)


app.include_router(users)
app.include_router(auth)
app.include_router(blogs)
app.include_router(search)
app.include_router(stars)
app.include_router(images)

