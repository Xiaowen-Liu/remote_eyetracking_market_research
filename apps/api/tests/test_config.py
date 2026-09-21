from fastapi.testclient import TestClient

from webgaze_api.config import Settings
from webgaze_api.main import create_app


def test_provider_database_url_uses_psycopg3_driver() -> None:
    settings = Settings(database_url="postgresql://user:pass@database:5432/webgaze")

    assert settings.database_url == "postgresql+psycopg://user:pass@database:5432/webgaze"


def test_explicit_sqlalchemy_database_url_is_unchanged() -> None:
    url = "sqlite+pysqlite:///:memory:"

    assert Settings(database_url=url).database_url == url


def test_rate_limit_backend_defaults_to_environment_aware_auto() -> None:
    assert Settings().rate_limit_backend == "auto"


def test_cors_origin_regex_allows_only_matching_preview_domains() -> None:
    settings = Settings(
        cors_origins=["https://webgaze-research.vercel.app"],
        cors_origin_regex=(
            r"https://webgaze-research-[a-z0-9]+-xiaowen-l-projects10\.vercel\.app"
        ),
    )

    with TestClient(create_app(settings)) as client:
        allowed = client.options(
            "/api/v1/projects",
            headers={
                "Origin": "https://webgaze-research-fqu7pp5dc-xiaowen-l-projects10.vercel.app",
                "Access-Control-Request-Method": "GET",
            },
        )
        rejected = client.options(
            "/api/v1/projects",
            headers={
                "Origin": "https://webgaze-research-attacker.vercel.app",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == (
        "https://webgaze-research-fqu7pp5dc-xiaowen-l-projects10.vercel.app"
    )
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers
