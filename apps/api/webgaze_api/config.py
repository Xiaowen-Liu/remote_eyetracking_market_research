from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="WEBGAZE_",
        extra="ignore",
    )

    environment: str = "development"
    database_url: str = Field(default="postgresql+psycopg://webgaze:webgaze@localhost:5432/webgaze")
    cors_origins: list[str] = ["http://localhost:3000"]
    sql_echo: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
