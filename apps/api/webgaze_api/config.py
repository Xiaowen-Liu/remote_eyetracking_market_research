from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="WEBGAZE_",
        extra="ignore",
    )

    environment: str = "development"
    database_url: str = Field(default="postgresql+psycopg://webgaze:webgaze@localhost:5432/webgaze")
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    sql_echo: bool = False

    @field_validator("database_url", mode="before")
    @classmethod
    def use_psycopg3_driver(cls, value: str) -> str:
        """Make provider-style PostgreSQL URLs explicit for SQLAlchemy."""
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
