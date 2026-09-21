from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .models import (
    AnalysisJob,
    AnalysisResult,
    CalibrationResult,
    GazeSample,
    GazeSampleBatch,
    ParticipantSession,
    RetentionTombstone,
    SessionEvent,
    SessionReplayContext,
    Study,
    StudyVersion,
    TaskRun,
)


@dataclass(frozen=True)
class RetentionCandidateRecord:
    session_id: uuid.UUID
    study_id: uuid.UUID
    study_version_id: uuid.UUID
    retention_expired_at: datetime


def retention_candidates(
    db: Session, project_id: uuid.UUID, *, now: datetime, limit: int
) -> list[RetentionCandidateRecord]:
    rows = db.execute(
        select(ParticipantSession, StudyVersion.study_id)
        .join(StudyVersion, StudyVersion.id == ParticipantSession.study_version_id)
        .join(Study, Study.id == StudyVersion.study_id)
        .where(
            Study.project_id == project_id,
            ParticipantSession.retention_expires_at <= now,
        )
        .order_by(ParticipantSession.retention_expires_at, ParticipantSession.id)
        .limit(limit)
    ).all()
    return [
        RetentionCandidateRecord(
            session_id=session.id,
            study_id=study_id,
            study_version_id=session.study_version_id,
            retention_expired_at=session.retention_expires_at,
        )
        for session, study_id in rows
    ]


def _count(db: Session, model: type, condition: object) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(condition)) or 0)


def delete_expired_session(
    db: Session,
    candidate: RetentionCandidateRecord,
    *,
    project_id: uuid.UUID,
    deleted_at: datetime,
) -> dict[str, int]:
    session_id = candidate.session_id
    batch_ids = select(GazeSampleBatch.id).where(GazeSampleBatch.session_id == session_id)
    counts = {
        "gaze_samples": _count(db, GazeSample, GazeSample.batch_id.in_(batch_ids)),
        "gaze_sample_batches": _count(
            db, GazeSampleBatch, GazeSampleBatch.session_id == session_id
        ),
        "session_events": _count(db, SessionEvent, SessionEvent.session_id == session_id),
        "session_replay_contexts": _count(
            db, SessionReplayContext, SessionReplayContext.session_id == session_id
        ),
        "task_runs": _count(db, TaskRun, TaskRun.session_id == session_id),
        "calibration_results": _count(
            db, CalibrationResult, CalibrationResult.session_id == session_id
        ),
        "analysis_results": _count(db, AnalysisResult, AnalysisResult.session_id == session_id),
        "analysis_jobs": _count(db, AnalysisJob, AnalysisJob.session_id == session_id),
        "participant_sessions": 1,
    }
    db.execute(delete(GazeSample).where(GazeSample.batch_id.in_(batch_ids)))
    for model in (
        AnalysisResult,
        AnalysisJob,
        SessionReplayContext,
        SessionEvent,
        TaskRun,
        CalibrationResult,
        GazeSampleBatch,
    ):
        db.execute(delete(model).where(model.session_id == session_id))
    db.execute(delete(ParticipantSession).where(ParticipantSession.id == session_id))
    db.add(
        RetentionTombstone(
            session_id=session_id,
            project_id=project_id,
            study_id=candidate.study_id,
            study_version_id=candidate.study_version_id,
            retention_expired_at=candidate.retention_expired_at,
            deleted_at=deleted_at,
            deleted_counts=counts,
        )
    )
    return counts


def run_project_retention(
    db: Session,
    project_id: uuid.UUID,
    *,
    dry_run: bool,
    limit: int,
    now: datetime | None = None,
) -> tuple[datetime, list[RetentionCandidateRecord], dict[str, int]]:
    evaluated_at = now or datetime.now(timezone.utc)
    candidates = retention_candidates(db, project_id, now=evaluated_at, limit=limit)
    totals: Counter[str] = Counter()
    if not dry_run:
        for candidate in candidates:
            totals.update(
                delete_expired_session(
                    db, candidate, project_id=project_id, deleted_at=evaluated_at
                )
            )
    return evaluated_at, candidates, dict(totals)
