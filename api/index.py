from fastapi import FastAPI
import models

from database import engine

from routes.auth import router as auth
from routes.blogs import router as blogs
from routes.stars import router as stars
from routes.search import router as search
from routes.images import router as images
from routes.users import router as users

from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


@app.get("/api/test")
def test():
    return {"status": "FastAPI is working"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


models.Base.metadata.create_all(bind=engine)

app.include_router(users, prefix="/api")
app.include_router(auth, prefix="/api")
app.include_router(blogs, prefix="/api")
app.include_router(search, prefix="/api")
app.include_router(stars, prefix="/api")
app.include_router(images, prefix="/api")