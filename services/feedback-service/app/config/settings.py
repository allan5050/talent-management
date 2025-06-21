from pydantic_settings import BaseSettings
from uuid import UUID

class Settings(BaseSettings):
    DATABASE_URL: str
    PORT: int = 8001
    
    # Per the assignment, API endpoints operate on a single, implicit "organization".
    # This setting specifies the UUID of that organization.
    DEFAULT_ORGANIZATION_ID: UUID = "8a1a7ac2-e528-4e63-8e2c-3a37d1472e35"

    class Config:
        env_file = ".env"
        env_file_encoding = 'utf-8'

settings = Settings()
