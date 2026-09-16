from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select

from test_participants import gaze_batch, ready_session
from webgaze_api.models import (
    GazeSample,
    ParticipantSession,
    RetentionTombstone,
    Study,
    StudyVersion,
)


def test_retention_dry_run_then_deletes_expired_session_data(client, db_session):
    session_payload, participant_headers = ready_session(client)
    session_id = session_payload["id"]
    session_uuid = UUID(session_id)
    task = client.post(
        f"/api/v1/participant-sessions/{session_id}/task-runs",
        headers=participant_headers,
        json={"task_position": 1},
    )
    assert task.status_code == 201
    ingested = client.post(
        f"/api/v1/participant-sessions/{session_id}/gaze-batches",
        headers=participant_headers,
        json=gaze_batch("893cb9aa-da8f-40c7-90a8-8e18ef265aad", 1),
    )
    assert ingested.status_code == 201

    participant_session = db_session.get(ParticipantSession, session_uuid)
    participant_session.retention_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    project_id = db_session.scalar(
        select(Study.project_id)
        .join(StudyVersion, StudyVersion.study_id == Study.id)
        .where(StudyVersion.id == participant_session.study_version_id)
    )
    db_session.commit()

    preview = client.post(
        f"/api/v1/projects/{project_id}/retention/run",
        json={"dry_run": True, "limit": 100},
    )
    assert preview.status_code == 200
    assert preview.json()["deleted_sessions"] == 0
    assert preview.json()["candidates"][0]["session_id"] == session_id
    assert db_session.get(ParticipantSession, session_uuid) is not None

    executed = client.post(
        f"/api/v1/projects/{project_id}/retention/run",
        json={"dry_run": False, "limit": 100},
    )
    assert executed.status_code == 200
    assert executed.json()["deleted_sessions"] == 1
    assert executed.json()["deleted_counts"]["gaze_samples"] == 1
    db_session.expire_all()
    assert db_session.get(ParticipantSession, session_uuid) is None
    assert db_session.scalar(select(func.count()).select_from(GazeSample)) == 0
    tombstone = db_session.scalar(
        select(RetentionTombstone).where(RetentionTombstone.session_id == session_uuid)
    )
    assert tombstone is not None
    assert tombstone.project_id == project_id
    assert tombstone.deleted_counts["participant_sessions"] == 1

    repeated = client.post(
        f"/api/v1/projects/{project_id}/retention/run",
        json={"dry_run": False, "limit": 100},
    )
    assert repeated.status_code == 200
    assert repeated.json()["deleted_sessions"] == 0


def test_retention_requires_project_owner(client, db_session):
    session_payload, _ = ready_session(client)
    participant_session = db_session.get(
        ParticipantSession, UUID(session_payload["id"])
    )
    project_id = db_session.scalar(
        select(Study.project_id)
        .join(StudyVersion, StudyVersion.study_id == Study.id)
        .where(StudyVersion.id == participant_session.study_version_id)
    )
    forbidden = client.post(
        f"/api/v1/projects/{project_id}/retention/run",
        headers={"X-Demo-Owner-ID": "00000000-0000-0000-0000-000000000002"},
        json={"dry_run": True},
    )
    assert forbidden.status_code == 404
