#ORM is the abstract layer which connects database to fastapi

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import settings

from urllib.parse import quote_plus


password = quote_plus(settings.db_password)
SQLALCHEMY_DATABASE_URL =f"postgresql://{settings.db_username}:{password}@{settings.db_hostname}:{settings.db_port}/{settings.db_name}"#URL-> postgresql://<username>:<password>@<host>/<db name>
# SQLALCHEMY_DATABASE_URL = settings.database_url
engine=create_engine(SQLALCHEMY_DATABASE_URL ) # connects fastapi to postgres

try:
    with engine.connect() as connection:
        print("DATABASE CONNECTED SUCCESSFULLY")
except Exception as e:
    print("DATABASE CONNECTION FAILED:")
    print(e)
SessionLocal =sessionmaker(autocommit=False ,autoflush=False,bind=engine) # create db session for every request

Base=declarative_base() # tell about the table schema in db 


# DB CONNECTION (DEPENDENCY)   give connection to every router that call this dependency 
def get_db():
    db=SessionLocal()
    try:
        yield db
    finally:
        db.close()
