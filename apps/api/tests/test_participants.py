from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_studies import create_project, study_payload

from webgaze_api.models import GazeSample, SessionEvent


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


def consented_session(client: TestClient) -> tuple[dict, dict[str, str]]:
    link_token, consent_version = published_link(client)
    session = client.post(
        f"/api/v1/participate/{link_token}/sessions",
        json={"viewport_width": 1280, "viewport_height": 720},
    ).json()
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    response = client.post(
        f"/api/v1/participant-sessions/{session['id']}/consent",
        headers=headers,
        json={"accepted": True, "consent_version": consent_version},
    )
    assert response.status_code == 200
    return session, headers


def calibration_payload(attempt: int, quality_grade: str, error_px: float | None) -> dict:
    return {
        "attempt": attempt,
        "started_at": "2026-09-07T18:00:00Z",
        "completed_at": "2026-09-07T18:01:00Z",
        "target_count": 9,
        "observed_sample_count": 45,
        "error_px": error_px,
        "quality_grade": quality_grade,
        "diagnostics": {"stable_target_ratio": 0.78},
    }


def ready_session(client: TestClient) -> tuple[dict, dict[str, str]]:
    session, headers = consented_session(client)
    response = client.post(
        f"/api/v1/participant-sessions/{session['id']}/calibrations",
        headers=headers,
        json=calibration_payload(1, "strong", 38.5),
    )
    assert response.status_code == 201
    return session, headers


def test_calibration_records_failed_retry_then_accepts_quality(client: TestClient) -> None:
    session, headers = consented_session(client)
    endpoint = f"/api/v1/participant-sessions/{session['id']}/calibrations"

    failed = client.post(
        endpoint,
        headers=headers,
        json=calibration_payload(1, "failed", None),
    )
    assert failed.status_code == 201
    assert failed.json()["accepted"] is False
    assert failed.json()["lifecycle"] == "calibrating"
    assert failed.json()["attempts_remaining"] == 2

    skipped_attempt = client.post(
        endpoint,
        headers=headers,
        json=calibration_payload(3, "strong", 30),
    )
    assert skipped_attempt.status_code == 409
    assert skipped_attempt.json()["error"]["code"] == "CALIBRATION_ATTEMPT_OUT_OF_ORDER"

    accepted = client.post(
        endpoint,
        headers=headers,
        json=calibration_payload(2, "variable", 74),
    )
    assert accepted.status_code == 201
    assert accepted.json()["accepted"] is True
    assert accepted.json()["lifecycle"] == "ready"


def test_tasks_run_in_published_order_and_never_overlap(client: TestClient) -> None:
    session, headers = ready_session(client)
    endpoint = f"/api/v1/participant-sessions/{session['id']}/task-runs"

    out_of_order = client.post(endpoint, headers=headers, json={"task_position": 2})
    assert out_of_order.status_code == 409
    assert out_of_order.json()["error"]["code"] == "TASK_OUT_OF_ORDER"

    started = client.post(endpoint, headers=headers, json={"task_position": 1})
    assert started.status_code == 201
    assert started.json()["outcome"] == "running"
    assert started.json()["session_lifecycle"] == "running"

    overlapping = client.post(endpoint, headers=headers, json={"task_position": 1})
    assert overlapping.status_code == 409
    assert overlapping.json()["error"]["code"] == "TASK_ALREADY_RUNNING"

    completed = client.post(
        f"{endpoint}/{started.json()['id']}/complete",
        headers=headers,
        json={"outcome": "completed"},
    )
    assert completed.status_code == 200
    assert completed.json()["outcome"] == "completed"

    repeated = client.post(
        f"{endpoint}/{started.json()['id']}/complete",
        headers=headers,
        json={"outcome": "skipped"},
    )
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "TASK_RUN_ALREADY_ENDED"


def gaze_batch(client_batch_id: str, sequence: int, x: float = 0.25) -> dict:
    return {
        "client_batch_id": client_batch_id,
        "sequence": sequence,
        "schema_version": "1.0",
        "captured_from": "2026-09-07T18:02:00Z",
        "captured_to": "2026-09-07T18:02:01Z",
        "samples": [
            {
                "timestamp": "2026-09-07T18:02:00.500Z",
                "x_normalized": x,
                "y_normalized": 0.75,
                "confidence": 0.91,
                "scroll_x": 0,
                "scroll_y": 320,
                "viewport_width": 1280,
                "viewport_height": 720,
            }
        ],
    }


def test_gaze_batches_are_idempotent_and_report_sequence_gaps(
    client: TestClient, db_session: Session
) -> None:
    session, headers = ready_session(client)
    task = client.post(
        f"/api/v1/participant-sessions/{session['id']}/task-runs",
        headers=headers,
        json={"task_position": 1},
    )
    assert task.status_code == 201
    endpoint = f"/api/v1/participant-sessions/{session['id']}/gaze-batches"
    batch_id = "773cb9aa-da8f-40c7-90a8-8e18ef265aad"

    out_of_order = client.post(endpoint, headers=headers, json=gaze_batch(batch_id, 2))
    assert out_of_order.status_code == 201
    assert out_of_order.json()["missing_sequences"] == [0, 1]
    assert out_of_order.json()["replayed"] is False

    replay = client.post(endpoint, headers=headers, json=gaze_batch(batch_id, 2))
    assert replay.status_code == 201
    assert replay.json()["id"] == out_of_order.json()["id"]
    assert replay.json()["replayed"] is True
    assert db_session.scalar(select(func.count()).select_from(GazeSample)) == 1

    conflict = client.post(endpoint, headers=headers, json=gaze_batch(batch_id, 2, x=0.9))
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "GAZE_BATCH_CONFLICT"

    different_id_same_sequence = client.post(
        endpoint,
        headers=headers,
        json=gaze_batch("2a6bd2e5-7041-4253-b705-52ee850b9b30", 2),
    )
    assert different_id_same_sequence.status_code == 409
    assert db_session.scalar(select(func.count()).select_from(GazeSample)) == 1
    assert db_session.scalar(select(func.count()).select_from(SessionEvent)) == 2


def test_gaze_batch_validation_and_state_are_enforced(client: TestClient) -> None:
    session, headers = ready_session(client)
    endpoint = f"/api/v1/participant-sessions/{session['id']}/gaze-batches"
    payload = gaze_batch("93743b68-137b-4af9-ac27-42625824c983", 0)

    before_task = client.post(endpoint, headers=headers, json=payload)
    assert before_task.status_code == 409
    assert before_task.json()["error"]["code"] == "INVALID_SESSION_STATE"

    client.post(
        f"/api/v1/participant-sessions/{session['id']}/task-runs",
        headers=headers,
        json={"task_position": 1},
    )
    payload["samples"][0]["x_normalized"] = 1.2
    invalid_coordinate = client.post(endpoint, headers=headers, json=payload)
    assert invalid_coordinate.status_code == 422
