from webgaze_api.config import Settings


def test_provider_database_url_uses_psycopg3_driver() -> None:
    settings = Settings(database_url="postgresql://user:pass@database:5432/webgaze")

    assert settings.database_url == "postgresql+psycopg://user:pass@database:5432/webgaze"


def test_explicit_sqlalchemy_database_url_is_unchanged() -> None:
    url = "sqlite+pysqlite:///:memory:"

    assert Settings(database_url=url).database_url == url
