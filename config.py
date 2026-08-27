from pydantic_settings import BaseSettings


class Setting(BaseSettings):

    db_hostname:str
    db_port:str
    db_password:str
    db_name:str
    db_username:str
    secret_key:str
    algorithm:str
    access_token_expiration_minute:int
    supabase_url: str
    supabase_key: str
    supabase_bucket: str

    class Config:
        env_file=".env"
settings=Setting()

# print("SECRET_KEY:", settings.secret_key)
# print("ALGORITHM:", settings.algorithm)
# print("EXP:", settings.access_token_expiration_minute)