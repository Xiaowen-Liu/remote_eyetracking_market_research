from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import select

from webgaze_api.auth import hash_password, hash_session_token, verify_password
from webgaze_api.dependencies import DEMO_OWNER_ID
from webgaze_api.models import Researcher, ResearcherSession


def create_researcher(
    db_session,
    *,
    email="researcher@example.com",
    password="correct-horse-battery",
):
    researcher = Researcher(
        id=DEMO_OWNER_ID,
        email=email,
        display_name="Researcher",
        password_hash=hash_password(password),
    )
    db_session.add(researcher)
    db_session.commit()
    return researcher


def test_password_hash_is_salted_and_verifiable():
    first = hash_password("correct-horse-battery")
    second = hash_password("correct-horse-battery")

    assert first != second
    assert "correct-horse-battery" not in first
    assert verify_password("correct-horse-battery", first)
    assert not verify_password("wrong-password-value", first)


def test_login_me_and_logout_use_hash_stored_expiring_session(client, db_session):
    researcher = create_researcher(db_session)

    login = client.post(
        "/api/v1/auth/login",
        json={"email": " Researcher@Example.com ", "password": "correct-horse-battery"},
    )
    assert login.status_code == 200
    payload = login.json()
    raw_token = payload["access_token"]
    assert payload["researcher"]["id"] == str(researcher.id)
    assert payload["token_type"] == "bearer"

    stored = db_session.scalar(select(ResearcherSession))
    assert stored is not None
    assert stored.token_hash == hash_session_token(raw_token)
    assert raw_token.encode() != stored.token_hash

    headers = {"Authorization": f"Bearer {raw_token}"}
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "researcher@example.com"

    logout = client.post("/api/v1/auth/logout", headers=headers)
    assert logout.status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_login_failure_does_not_reveal_account_existence(client, db_session):
    create_researcher(db_session)

    wrong_password = client.post(
        "/api/v1/auth/login",
        json={"email": "researcher@example.com", "password": "incorrect-password"},
    )
    missing_account = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@example.com", "password": "incorrect-password"},
    )

    assert wrong_password.status_code == 401
    assert missing_account.status_code == 401
    assert wrong_password.json()["error"] == missing_account.json()["error"]
    assert wrong_password.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_required_auth_rejects_missing_or_invalid_sessions(client, monkeypatch):
    monkeypatch.setattr(
        "webgaze_api.dependencies.get_settings",
        lambda: SimpleNamespace(researcher_auth_required=True, environment="production"),
    )

    missing = client.get("/api/v1/projects")
    invalid = client.get(
        "/api/v1/projects",
        headers={"Authorization": "Bearer invalid-researcher-session"},
    )

    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "RESEARCHER_AUTH_REQUIRED"
    assert invalid.status_code == 401
    assert invalid.json()["error"]["code"] == "INVALID_RESEARCHER_SESSION"


def test_production_disables_demo_owner_header(client, monkeypatch):
    monkeypatch.setattr(
        "webgaze_api.dependencies.get_settings",
        lambda: SimpleNamespace(researcher_auth_required=False, environment="production"),
    )

    response = client.get(
        "/api/v1/projects",
        headers={"X-Demo-Owner-ID": str(UUID(int=2))},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "RESEARCHER_AUTH_REQUIRED"
