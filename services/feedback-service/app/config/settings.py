from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    PORT: int = 8001

    class Config:
        env_file = ".env"

settings = Settings()
