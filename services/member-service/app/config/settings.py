from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    PORT: int = 8002

    class Config:
        env_file = ".env"

settings = Settings() 