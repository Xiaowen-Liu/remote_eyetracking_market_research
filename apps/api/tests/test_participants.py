from fastapi.testclient import TestClient
from test_studies import create_project, study_payload


def published_link(client: TestClient) -> tuple[str, str]:
    project_id = create_project(client)
    study = client.post(
        f"/api/v1/projects/{project_id}/studies", json=study_payload()
    ).json()
    published = client.post(
        f"/api/v1/studies/{study['id']}/publish",
        headers={"Idempotency-Key": "participant-flow"},
    ).json()
    link = published["participant_link"]
    return link["token"], published["version"]["consent_version"]


def test_participant_session_and_consent_flow(client: TestClient) -> None:
    link_token, consent_version = published_link(client)
    created = client.post(
        f"/api/v1/participate/{link_token}/sessions",
        json={
            "browser_family": "Chromium",
            "viewport_width": 1440,
            "viewport_height": 900,
            "device_pixel_ratio": 2,
        },
    )

    assert created.status_code == 201
    session = created.json()
    assert session["lifecycle"] == "created"
    assert session["participant_alias"].startswith("P-")
    assert len(session["access_token"]) >= 32

    missing_token = client.post(
        f"/api/v1/participant-sessions/{session['id']}/consent",
        json={"accepted": True, "consent_version": consent_version},
    )
    assert missing_token.status_code == 401
    assert missing_token.json()["error"]["code"] == "SESSION_TOKEN_REQUIRED"

    consent = client.post(
        f"/api/v1/participant-sessions/{session['id']}/consent",
        headers={"Authorization": f"Bearer {session['access_token']}"},
        json={"accepted": True, "consent_version": consent_version},
    )
    assert consent.status_code == 200
    assert consent.json()["lifecycle"] == "consented"
    assert consent.json()["consent_version"] == consent_version

    repeated = client.post(
        f"/api/v1/participant-sessions/{session['id']}/consent",
        headers={"Authorization": f"Bearer {session['access_token']}"},
        json={"accepted": True, "consent_version": consent_version},
    )
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "INVALID_SESSION_STATE"


def test_consent_version_and_session_token_are_enforced(client: TestClient) -> None:
    link_token, _ = published_link(client)
    session = client.post(
        f"/api/v1/participate/{link_token}/sessions",
        json={"viewport_width": 1280, "viewport_height": 720},
    ).json()

    wrong_token = client.post(
        f"/api/v1/participant-sessions/{session['id']}/consent",
        headers={"Authorization": "Bearer wrong-token"},
        json={"accepted": True, "consent_version": "demo-v1"},
    )
    assert wrong_token.status_code == 404

    stale_consent = client.post(
        f"/api/v1/participant-sessions/{session['id']}/consent",
        headers={"Authorization": f"Bearer {session['access_token']}"},
        json={"accepted": True, "consent_version": "stale-v0"},
    )
    assert stale_consent.status_code == 409
    assert stale_consent.json()["error"]["code"] == "CONSENT_VERSION_MISMATCH"
