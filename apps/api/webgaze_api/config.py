from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
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
    cors_origin_regex: str | None = None
    sql_echo: bool = False
    researcher_auth_required: bool = False
    researcher_session_hours: int = Field(default=12, ge=1, le=168)
    rate_limit_enabled: bool = True
    rate_limit_backend: Literal["auto", "memory", "database"] = "auto"
    login_rate_limit_per_minute: int = Field(default=10, ge=1, le=10_000)
    participant_rate_limit_per_minute: int = Field(default=120, ge=1, le=100_000)
    trust_proxy_headers: bool = False
    demo_researcher_email: str = "demo@webgaze.local"
    demo_researcher_password: SecretStr | None = None

    @field_validator("database_url", mode="before")
    @classmethod
    def use_psycopg3_driver(cls, value: str) -> str:
        """Make provider-style PostgreSQL URLs explicit for SQLAlchemy."""
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value

    @field_validator("demo_researcher_password", mode="before")
    @classmethod
    def empty_researcher_password_is_unset(cls, value: object) -> object:
        return None if value == "" else value


@lru_cache
def get_settings() -> Settings:
    return Settings()
