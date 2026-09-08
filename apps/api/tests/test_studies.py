from uuid import UUID

from fastapi.testclient import TestClient


def study_payload(title: str = "Checkout attention study") -> dict:
    return {
        "title": title,
        "description": "A synthetic study for public demonstration.",
        "consent_version": "demo-v1",
        "consent_text": "I consent to local webcam-based gaze estimation.",
        "target_origins": ["https://demo.example.com"],
        "calibration_policy": {
            "minimum_quality": "variable",
            "allow_retry": True,
            "maximum_attempts": 3,
        },
        "collection_policy": {"screenshots_enabled": False, "sample_interval_ms": 100},
        "retention_days": 30,
        "tasks": [
            {
                "position": 1,
                "title": "Find pricing",
                "prompt": "Find the plan that best fits a small research team.",
                "start_url": "https://demo.example.com/pricing",
                "success_url_pattern": "/checkout",
                "time_limit_ms": 120000,
                "areas_of_interest": [
                    {
                        "label": "Pricing comparison",
                        "source": "selector",
                        "selector": "[data-demo='pricing-grid']",
                    }
                ],
            },
            {
                "position": 2,
                "title": "Begin checkout",
                "prompt": "Start checkout without submitting payment information.",
                "start_url": "https://demo.example.com/pricing",
                "time_limit_ms": 120000,
                "areas_of_interest": [],
            },
        ],
    }


def create_project(client: TestClient) -> str:
    response = client.post(
        "/api/v1/projects",
        json={"name": "Synthetic accessibility research"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_study_draft_crud_and_ownership(client: TestClient) -> None:
    project_id = create_project(client)
    created = client.post(f"/api/v1/projects/{project_id}/studies", json=study_payload())
    assert created.status_code == 201
    study = created.json()
    assert study["draft_revision"] == 1
    assert len(study["tasks"]) == 2

    listed = client.get(f"/api/v1/projects/{project_id}/studies")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    updated_payload = study_payload("Revised checkout attention study")
    updated_payload["tasks"] = updated_payload["tasks"][:1]
    updated = client.put(f"/api/v1/studies/{study['id']}/draft", json=updated_payload)
    assert updated.status_code == 200
    assert updated.json()["draft_revision"] == 2
    assert len(updated.json()["tasks"]) == 1

    hidden = client.get(
        f"/api/v1/studies/{study['id']}/draft",
        headers={"X-Demo-Owner-ID": str(UUID(int=2))},
    )
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "STUDY_NOT_FOUND"


def test_publish_creates_immutable_snapshot_and_is_idempotent(client: TestClient) -> None:
    project_id = create_project(client)
    created = client.post(f"/api/v1/projects/{project_id}/studies", json=study_payload()).json()
    study_id = created["id"]

    missing_key = client.post(f"/api/v1/studies/{study_id}/publish")
    assert missing_key.status_code == 400
    assert missing_key.json()["error"]["code"] == "INVALID_IDEMPOTENCY_KEY"

    first = client.post(
        f"/api/v1/studies/{study_id}/publish",
        headers={"Idempotency-Key": "publish-demo-v1"},
    )
    assert first.status_code == 200
    body = first.json()
    assert body["study"]["lifecycle"] == "published"
    assert body["version"]["version_number"] == 1
    assert body["version"]["source_revision"] == 1
    assert len(body["participant_link"]["token"]) >= 32
    assert body["replayed"] is False

    protocol = client.get(body["participant_link"]["participant_url"])
    assert protocol.status_code == 200
    assert protocol.json()["title"] == "Checkout attention study"
    assert [task["position"] for task in protocol.json()["tasks"]] == [1, 2]
    assert "study_id" not in protocol.json()
    assert "owner_id" not in protocol.json()

    restored_link = client.get(f"/api/v1/studies/{study_id}/participant-link")
    assert restored_link.status_code == 200
    assert restored_link.json()["participant_url"] == body["participant_link"]["participant_url"]

    missing_link = client.get("/api/v1/participate/not-a-real-token")
    assert missing_link.status_code == 404
    assert missing_link.json()["error"]["code"] == "PARTICIPANT_LINK_NOT_FOUND"

    replay = client.post(
        f"/api/v1/studies/{study_id}/publish",
        headers={"Idempotency-Key": "publish-demo-v1"},
    )
    assert replay.status_code == 200
    assert replay.json()["version"]["id"] == body["version"]["id"]
    assert replay.json()["participant_link"] is None
    assert replay.json()["replayed"] is True

    revised_payload = study_payload("Version two")
    revised = client.put(f"/api/v1/studies/{study_id}/draft", json=revised_payload)
    assert revised.status_code == 200
    second = client.post(
        f"/api/v1/studies/{study_id}/publish",
        headers={"Idempotency-Key": "publish-demo-v2"},
    )
    assert second.status_code == 200
    assert second.json()["version"]["version_number"] == 2
    assert second.json()["version"]["source_revision"] == 2

    first_version = client.get(f"/api/v1/studies/{study_id}/versions/1")
    assert first_version.status_code == 200
    assert first_version.json()["title"] == "Checkout attention study"
    assert first_version.json()["tasks"][0]["title"] == "Find pricing"

    retry_original_key = client.post(
        f"/api/v1/studies/{study_id}/publish",
        headers={"Idempotency-Key": "publish-demo-v1"},
    )
    assert retry_original_key.status_code == 200
    assert retry_original_key.json()["version"]["version_number"] == 1
    assert retry_original_key.json()["replayed"] is True


def test_invalid_task_positions_return_stable_validation_error(client: TestClient) -> None:
    project_id = create_project(client)
    payload = study_payload()
    payload["tasks"][1]["position"] = 1

    response = client.post(f"/api/v1/projects/{project_id}/studies", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["request_id"]
