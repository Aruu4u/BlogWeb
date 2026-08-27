from database import Base
from sqlalchemy import Column, Integer ,String, Boolean,ForeignKey,Text
from sqlalchemy.sql.sqltypes import TIMESTAMP
from sqlalchemy.sql.expression import text
from sqlalchemy.orm import relationship


class Blogs(Base):
    __tablename__ = "Blogs"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    thumbnail = Column(String, nullable=True)
    author_id = Column(
        Integer,
        ForeignKey("Users.id", ondelete="CASCADE"),
        nullable=False
    )

    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()")
    )

    visibility = Column(Boolean, nullable=False)

    owner = relationship("User", back_populates="blogs")

    images = relationship(
        "BlogImages",
        back_populates="blog",
        cascade="all, delete"
    )
    comments = relationship(
    "Comments",
    back_populates="blog",
    cascade="all, delete"
)

    stars = relationship(
    "Stars",
    back_populates="blog",
    cascade="all, delete"
)

class User(Base):
    __tablename__="Users"
    id =Column(Integer,primary_key=True,nullable=False)
    username=Column(String,unique=True,nullable=False)
    email=Column(String,unique=True,nullable=False)
    password=Column(String,nullable=False)
    profile_image=Column(String,nullable=True)
    bio=Column(String,nullable=True)
    created_at=Column(TIMESTAMP(timezone=True),nullable=False, server_default=text('now()'))
    blogs = relationship(
    "Blogs",
    back_populates="owner",
    cascade="all, delete"
)
    comments = relationship(
    "Comments",
    back_populates="user",
    cascade="all, delete"
)

    stars = relationship(
    "Stars",
    back_populates="user",
    cascade="all, delete"
)



class BlogImages(Base):
    __tablename__="BlogImages"
    id =Column(Integer,primary_key=True,nullable=False)
    blog_id=Column(Integer,ForeignKey("Blogs.id",ondelete="CASCADE"),nullable=False)
    image_url=Column(String,nullable=False)
    display_order=Column(Integer,nullable=False)
    blog = relationship("Blogs", back_populates="images")


class Stars(Base):
    __tablename__ = "Stars"

    user_id = Column(
        Integer,
        ForeignKey("Users.id", ondelete="CASCADE"),
        primary_key=True
    )

    blog_id = Column(
        Integer,
        ForeignKey("Blogs.id", ondelete="CASCADE"),
        primary_key=True
    )

    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()")
    )
    user = relationship("User", back_populates="stars")
    blog = relationship("Blogs", back_populates="stars")


class Comments(Base):
    __tablename__ = "Comments"

    id = Column(Integer, primary_key=True)

    user_id = Column(
        Integer,
        ForeignKey("Users.id", ondelete="CASCADE"),
        nullable=False
    )

    blog_id = Column(
        Integer,
        ForeignKey("Blogs.id", ondelete="CASCADE"),
        nullable=False
    )

    content = Column(Text, nullable=False)

    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()")
    )
    user = relationship("User", back_populates="comments")
    blog = relationship("Blogs", back_populates="comments")


