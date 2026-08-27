from passlib.context import CryptContext
#CryptContext object tells which algo , how to hash, how to verify 
pwd_context=CryptContext(schemes=["bcrypt"], deprecated="auto")

#never store plain password convert them into hashed pass then store
def hash(password:str):
    return pwd_context.hash(password)


#for verifying if the entered password is matched with the already stored hashed password
def verifyPassword(plain_password , hashed_password):
    return pwd_context.verify(plain_password,hashed_password)