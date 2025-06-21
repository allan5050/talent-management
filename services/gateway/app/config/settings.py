from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    FEEDBACK_SERVICE_URL: str
    MEMBER_SERVICE_URL: str
    PORT: int = 8000

    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
