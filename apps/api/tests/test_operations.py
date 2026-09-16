import json
import logging

from fastapi.testclient import TestClient

from webgaze_api.config import Settings
from webgaze_api.database import get_db
from webgaze_api.main import create_app


def test_readiness_checks_database(client):
    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok"}


def test_invalid_request_id_is_replaced(client):
    response = client.get("/healthz", headers={"X-Request-ID": "bad id\nvalue"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] != "bad id\nvalue"


def test_access_log_is_structured_and_excludes_query_and_authorization(client, caplog):
    caplog.set_level(logging.INFO, logger="webgaze.access")

    response = client.get(
        "/healthz?secret=value",
        headers={"Authorization": "Bearer do-not-log", "X-Request-ID": "log-test"},
    )

    assert response.status_code == 200
    event = json.loads(caplog.records[-1].message)
    assert event["event"] == "http_request"
    assert event["request_id"] == "log-test"
    assert event["path"] == "/healthz"
    assert "secret" not in caplog.text
    assert "do-not-log" not in caplog.text


def test_login_rate_limit_returns_stable_error(db_session):
    settings = Settings(login_rate_limit_per_minute=1)
    app = create_app(settings)

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as client:
        payload = {"email": "x@y.com", "password": "invalid-pass"}
        first = client.post("/api/v1/auth/login", json=payload)
        second = client.post("/api/v1/auth/login", json=payload)

    assert first.status_code == 401
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "RATE_LIMITED"
    assert int(second.headers["Retry-After"]) >= 1
    assert second.headers["X-Request-ID"] == second.json()["request_id"]


def test_trusted_proxy_rate_limit_uses_first_forwarded_address(db_session):
    settings = Settings(login_rate_limit_per_minute=1, trust_proxy_headers=True)
    app = create_app(settings)

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    payload = {"email": "x@y.com", "password": "invalid-pass"}
    with TestClient(app) as client:
        first = client.post(
            "/api/v1/auth/login",
            json=payload,
            headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.1"},
        )
        second = client.post(
            "/api/v1/auth/login",
            json=payload,
            headers={"X-Forwarded-For": "203.0.113.11, 10.0.0.1"},
        )

    assert first.status_code == 401
    assert second.status_code == 401
