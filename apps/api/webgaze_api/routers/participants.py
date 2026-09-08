import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..analysis import ALGORITHM_VERSION, analysis_job_payload
from ..database import get_db
from ..errors import ApiError
from ..models import (
    AnalysisJob,
    CalibrationResult,
    GazeSample,
    GazeSampleBatch,
    ParticipantLink,
    ParticipantSession,
    QualityGrade,
    SessionEvent,
    SessionLifecycle,
    StudyLifecycle,
    Task,
    TaskOutcome,
    TaskRun,
)
from ..schemas import (
    CalibrationResultCreate,
    CalibrationResultResponse,
    ConsentCreate,
    ConsentResponse,
    ErrorResponse,
    GazeBatchCreate,
    GazeBatchResponse,
    ParticipantSessionCreate,
    ParticipantSessionResponse,
    SessionSubmitResponse,
    TaskRunComplete,
    TaskRunCreate,
    TaskRunResponse,
)

router = APIRouter(tags=["participant sessions"])
DbSession = Depends(get_db)


def token_digest(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def active_link(db: Session, token: str, *, lock: bool = False) -> ParticipantLink:
    statement = select(ParticipantLink).where(ParticipantLink.public_code == token)
    if lock:
        statement = statement.with_for_update()
    link = db.scalar(statement)
    if not link:
        raise ApiError(404, "PARTICIPANT_LINK_NOT_FOUND", "Participant link was not found")
    now = datetime.now(timezone.utc)
    if link.revoked_at:
        raise ApiError(410, "PARTICIPANT_LINK_REVOKED", "Participant link was revoked")
    if link.expires_at and link.expires_at <= now:
        raise ApiError(410, "PARTICIPANT_LINK_EXPIRED", "Participant link has expired")
    if link.study_version.study.lifecycle in {StudyLifecycle.CLOSED, StudyLifecycle.ARCHIVED}:
        raise ApiError(410, "STUDY_CLOSED", "This study is no longer accepting participants")
    if link.max_sessions is not None:
        count = db.scalar(
            select(func.count())
            .select_from(ParticipantSession)
            .where(ParticipantSession.study_version_id == link.study_version_id)
        )
        if (count or 0) >= link.max_sessions:
            raise ApiError(410, "PARTICIPANT_LINK_AT_CAPACITY", "Participant capacity was reached")
    return link


def authenticated_session(
    session_id: uuid.UUID,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = DbSession,
) -> ParticipantSession:
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(401, "SESSION_TOKEN_REQUIRED", "A participant session token is required")
    raw_token = authorization.removeprefix("Bearer ").strip()
    session = db.scalar(select(ParticipantSession).where(ParticipantSession.id == session_id))
    if (
        not session
        or not session.access_token_hash
        or not secrets.compare_digest(session.access_token_hash, token_digest(raw_token))
    ):
        raise ApiError(404, "SESSION_NOT_FOUND", "Participant session was not found")
    return session


CurrentParticipantSession = Annotated[ParticipantSession, Depends(authenticated_session)]

QUALITY_RANK = {
    QualityGrade.FAILED: 0,
    QualityGrade.LIMITED: 1,
    QualityGrade.VARIABLE: 2,
    QualityGrade.STRONG: 3,
}


def event(
    session: ParticipantSession,
    kind: str,
    occurred_at: datetime,
    *,
    task_run_id: uuid.UUID | None = None,
    payload: dict | None = None,
) -> SessionEvent:
    return SessionEvent(
        session_id=session.id,
        task_run_id=task_run_id,
        kind=kind,
        occurred_at=occurred_at,
        payload=payload or {},
    )


def task_run_response(run: TaskRun, task: Task, lifecycle: SessionLifecycle) -> TaskRunResponse:
    return TaskRunResponse(
        id=run.id,
        session_id=run.session_id,
        task_position=task.position,
        outcome=run.outcome,
        started_at=run.started_at,
        ended_at=run.ended_at,
        first_sequence=run.first_sequence,
        last_sequence=run.last_sequence,
        session_lifecycle=lifecycle,
    )


def batch_checksum(payload: GazeBatchCreate) -> str:
    canonical = payload.model_dump(mode="json")
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def sequence_state(db: Session, session_id: uuid.UUID) -> tuple[int, list[int]]:
    sequences = list(
        db.scalars(
            select(GazeSampleBatch.sequence)
            .where(GazeSampleBatch.session_id == session_id)
            .order_by(GazeSampleBatch.sequence)
        )
    )
    highest = max(sequences, default=-1)
    present = set(sequences)
    return highest, [sequence for sequence in range(highest + 1) if sequence not in present]


@router.post(
    "/participate/{token}/sessions",
    response_model=ParticipantSessionResponse,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ErrorResponse}, 410: {"model": ErrorResponse}},
    operation_id="createParticipantSession",
)
def create_participant_session(
    token: str, payload: ParticipantSessionCreate, db: Session = DbSession
) -> ParticipantSessionResponse:
    link = active_link(db, token, lock=True)
    now = datetime.now(timezone.utc)
    access_token = secrets.token_urlsafe(32)
    session = ParticipantSession(
        study_version_id=link.study_version_id,
        participant_alias=f"P-{secrets.token_hex(3).upper()}",
        access_token_hash=token_digest(access_token),
        lifecycle=SessionLifecycle.CREATED,
        browser_family=payload.browser_family,
        viewport_width=payload.viewport_width,
        viewport_height=payload.viewport_height,
        device_pixel_ratio=payload.device_pixel_ratio,
        retention_expires_at=now + timedelta(days=link.study_version.retention_days),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return ParticipantSessionResponse(
        id=session.id,
        lifecycle=session.lifecycle,
        participant_alias=session.participant_alias,
        access_token=access_token,
        retention_expires_at=session.retention_expires_at,
    )


@router.post(
    "/participant-sessions/{session_id}/consent",
    response_model=ConsentResponse,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="recordParticipantConsent",
)
def record_consent(
    payload: ConsentCreate,
    participant_session: CurrentParticipantSession,
    db: Session = DbSession,
) -> ConsentResponse:
    if participant_session.lifecycle != SessionLifecycle.CREATED:
        raise ApiError(409, "INVALID_SESSION_STATE", "Consent can only be recorded once")
    expected_version = participant_session.study_version.consent_version
    if payload.consent_version != expected_version:
        raise ApiError(409, "CONSENT_VERSION_MISMATCH", "The consent form is no longer current")
    now = datetime.now(timezone.utc)
    participant_session.consent_version = expected_version
    participant_session.consented_at = now
    participant_session.lifecycle = SessionLifecycle.CONSENTED
    db.commit()
    return ConsentResponse(
        session_id=participant_session.id,
        lifecycle=participant_session.lifecycle,
        consent_version=expected_version,
        consented_at=now,
    )


@router.post(
    "/participant-sessions/{session_id}/calibrations",
    response_model=CalibrationResultResponse,
    status_code=status.HTTP_201_CREATED,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="recordCalibrationResult",
)
def record_calibration(
    payload: CalibrationResultCreate,
    participant_session: CurrentParticipantSession,
    db: Session = DbSession,
) -> CalibrationResultResponse:
    if participant_session.lifecycle not in {
        SessionLifecycle.CONSENTED,
        SessionLifecycle.CALIBRATING,
    }:
        raise ApiError(409, "INVALID_SESSION_STATE", "Calibration is not allowed now")
    policy = participant_session.study_version.calibration_policy
    maximum_attempts = int(policy.get("maximum_attempts", 3))
    if not policy.get("allow_retry", True):
        maximum_attempts = 1
    expected_attempt = (
        db.scalar(
            select(func.max(CalibrationResult.attempt)).where(
                CalibrationResult.session_id == participant_session.id
            )
        )
        or 0
    ) + 1
    if payload.attempt != expected_attempt:
        raise ApiError(409, "CALIBRATION_ATTEMPT_OUT_OF_ORDER", "Use the next calibration attempt")
    if payload.attempt > maximum_attempts:
        raise ApiError(409, "CALIBRATION_ATTEMPTS_EXHAUSTED", "No calibration attempts remain")

    minimum = QualityGrade(policy.get("minimum_quality", QualityGrade.VARIABLE.value))
    accepted = QUALITY_RANK[payload.quality_grade] >= QUALITY_RANK[minimum]
    result = CalibrationResult(
        session_id=participant_session.id,
        attempt=payload.attempt,
        started_at=payload.started_at,
        completed_at=payload.completed_at,
        target_count=payload.target_count,
        observed_sample_count=payload.observed_sample_count,
        error_px=payload.error_px,
        quality_grade=payload.quality_grade,
        diagnostics=payload.diagnostics,
    )
    participant_session.lifecycle = (
        SessionLifecycle.READY if accepted else SessionLifecycle.CALIBRATING
    )
    db.add(result)
    db.add(
        event(
            participant_session,
            "calibration_completed",
            payload.completed_at,
            payload={
                "attempt": payload.attempt,
                "quality_grade": payload.quality_grade.value,
                "accepted": accepted,
            },
        )
    )
    db.commit()
    db.refresh(result)
    return CalibrationResultResponse(
        id=result.id,
        session_id=participant_session.id,
        attempt=result.attempt,
        lifecycle=participant_session.lifecycle,
        target_count=result.target_count,
        observed_sample_count=result.observed_sample_count,
        error_px=float(result.error_px) if result.error_px is not None else None,
        quality_grade=result.quality_grade,
        accepted=accepted,
        attempts_remaining=maximum_attempts - payload.attempt,
    )


@router.post(
    "/participant-sessions/{session_id}/task-runs",
    response_model=TaskRunResponse,
    status_code=status.HTTP_201_CREATED,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="startTaskRun",
)
def start_task_run(
    payload: TaskRunCreate,
    participant_session: CurrentParticipantSession,
    db: Session = DbSession,
) -> TaskRunResponse:
    if participant_session.lifecycle not in {SessionLifecycle.READY, SessionLifecycle.RUNNING}:
        raise ApiError(409, "INVALID_SESSION_STATE", "A task cannot be started now")
    running = db.scalar(
        select(TaskRun).where(
            TaskRun.session_id == participant_session.id,
            TaskRun.outcome == TaskOutcome.RUNNING,
        )
    )
    if running:
        raise ApiError(409, "TASK_ALREADY_RUNNING", "Finish the current task first")
    completed_positions = set(
        db.scalars(
            select(Task.position)
            .join(TaskRun, TaskRun.task_id == Task.id)
            .where(TaskRun.session_id == participant_session.id)
        )
    )
    expected_position = len(completed_positions) + 1
    if payload.task_position != expected_position:
        raise ApiError(409, "TASK_OUT_OF_ORDER", f"Start task {expected_position} next")
    task = db.scalar(
        select(Task).where(
            Task.study_version_id == participant_session.study_version_id,
            Task.position == payload.task_position,
        )
    )
    if not task:
        raise ApiError(404, "TASK_NOT_FOUND", "Task was not found in this study version")
    now = datetime.now(timezone.utc)
    run = TaskRun(
        session_id=participant_session.id,
        task_id=task.id,
        outcome=TaskOutcome.RUNNING,
        started_at=now,
        first_sequence=(
            participant_session.last_sequence_received + 1
            if participant_session.last_sequence_received is not None
            else 0
        ),
    )
    participant_session.lifecycle = SessionLifecycle.RUNNING
    if participant_session.started_at is None:
        participant_session.started_at = now
    db.add(run)
    db.flush()
    db.add(
        event(
            participant_session,
            "task_started",
            now,
            task_run_id=run.id,
            payload={"position": task.position},
        )
    )
    db.commit()
    db.refresh(run)
    return task_run_response(run, task, participant_session.lifecycle)


@router.post(
    "/participant-sessions/{session_id}/task-runs/{task_run_id}/complete",
    response_model=TaskRunResponse,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="completeTaskRun",
)
def complete_task_run(
    task_run_id: uuid.UUID,
    payload: TaskRunComplete,
    participant_session: CurrentParticipantSession,
    db: Session = DbSession,
) -> TaskRunResponse:
    run = db.scalar(
        select(TaskRun).where(
            TaskRun.id == task_run_id,
            TaskRun.session_id == participant_session.id,
        )
    )
    if not run:
        raise ApiError(404, "TASK_RUN_NOT_FOUND", "Task run was not found")
    if run.outcome != TaskOutcome.RUNNING:
        raise ApiError(409, "TASK_RUN_ALREADY_ENDED", "Task run has already ended")
    if participant_session.lifecycle != SessionLifecycle.RUNNING:
        raise ApiError(409, "INVALID_SESSION_STATE", "The session is not collecting")
    task = db.get(Task, run.task_id)
    now = datetime.now(timezone.utc)
    run.outcome = payload.outcome
    run.ended_at = now
    run.last_sequence = participant_session.last_sequence_received
    db.add(
        event(
            participant_session,
            f"task_{payload.outcome.value}",
            now,
            task_run_id=run.id,
            payload={"position": task.position},
        )
    )
    db.commit()
    return task_run_response(run, task, participant_session.lifecycle)


@router.post(
    "/participant-sessions/{session_id}/submit",
    response_model=SessionSubmitResponse,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="submitParticipantSession",
)
def submit_participant_session(
    participant_session: CurrentParticipantSession,
    db: Session = DbSession,
) -> SessionSubmitResponse:
    existing = db.scalar(
        select(AnalysisJob)
        .where(
            AnalysisJob.session_id == participant_session.id,
            AnalysisJob.algorithm_version == ALGORITHM_VERSION,
            AnalysisJob.attempt == 1,
        )
    )
    if participant_session.lifecycle == SessionLifecycle.SUBMITTED and existing:
        return SessionSubmitResponse(
            session_id=participant_session.id,
            lifecycle=participant_session.lifecycle,
            analysis_job=analysis_job_payload(existing),
            replayed=True,
        )
    if participant_session.lifecycle not in {SessionLifecycle.READY, SessionLifecycle.RUNNING}:
        raise ApiError(409, "INVALID_SESSION_STATE", "This session cannot be submitted now")

    running_task = db.scalar(
        select(TaskRun.id).where(
            TaskRun.session_id == participant_session.id,
            TaskRun.outcome == TaskOutcome.RUNNING,
        )
    )
    if running_task:
        raise ApiError(409, "TASK_STILL_RUNNING", "Finish the current task before submission")
    task_count = db.scalar(
        select(func.count())
        .select_from(Task)
        .where(Task.study_version_id == participant_session.study_version_id)
    )
    ended_count = db.scalar(
        select(func.count())
        .select_from(TaskRun)
        .where(TaskRun.session_id == participant_session.id)
    )
    if ended_count != task_count:
        raise ApiError(409, "TASKS_INCOMPLETE", "Every study task must have an outcome")
    _, missing = sequence_state(db, participant_session.id)
    if missing:
        raise ApiError(409, "GAZE_SEQUENCE_GAP", "Resolve missing gaze batches before submission")

    now = datetime.now(timezone.utc)
    participant_session.lifecycle = SessionLifecycle.SUBMITTED
    participant_session.ended_at = now
    job = AnalysisJob(
        session_id=participant_session.id,
        algorithm_version=ALGORITHM_VERSION,
        attempt=1,
        parameters={"sample_schema_version": "1.0", "task_segmentation": "sequence-boundaries"},
    )
    db.add(job)
    db.add(event(participant_session, "session_submitted", now))
    db.commit()
    db.refresh(job)
    return SessionSubmitResponse(
        session_id=participant_session.id,
        lifecycle=participant_session.lifecycle,
        analysis_job=analysis_job_payload(job),
        replayed=False,
    )


@router.post(
    "/participant-sessions/{session_id}/gaze-batches",
    response_model=GazeBatchResponse,
    status_code=status.HTTP_201_CREATED,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="ingestGazeBatch",
)
def ingest_gaze_batch(
    payload: GazeBatchCreate,
    participant_session: CurrentParticipantSession,
    db: Session = DbSession,
) -> GazeBatchResponse:
    if participant_session.lifecycle not in {SessionLifecycle.RUNNING, SessionLifecycle.PAUSED}:
        raise ApiError(409, "INVALID_SESSION_STATE", "Gaze collection is not active")
    checksum = batch_checksum(payload)
    existing = db.scalar(
        select(GazeSampleBatch).where(
            GazeSampleBatch.session_id == participant_session.id,
            (GazeSampleBatch.client_batch_id == payload.client_batch_id)
            | (GazeSampleBatch.sequence == payload.sequence),
        )
    )
    if existing:
        if (
            existing.client_batch_id != payload.client_batch_id
            or existing.sequence != payload.sequence
            or existing.payload_checksum != checksum
        ):
            raise ApiError(
                409,
                "GAZE_BATCH_CONFLICT",
                "This batch ID or sequence was already used for different content",
            )
        highest, missing = sequence_state(db, participant_session.id)
        return GazeBatchResponse(
            id=existing.id,
            client_batch_id=existing.client_batch_id,
            sequence=existing.sequence,
            sample_count=existing.sample_count,
            payload_checksum=existing.payload_checksum,
            replayed=True,
            highest_sequence_received=highest,
            missing_sequences=missing,
        )

    batch = GazeSampleBatch(
        client_batch_id=payload.client_batch_id,
        session_id=participant_session.id,
        sequence=payload.sequence,
        schema_version=payload.schema_version,
        captured_from=payload.captured_from,
        captured_to=payload.captured_to,
        sample_count=len(payload.samples),
        payload_checksum=checksum,
    )
    db.add(batch)
    db.flush()
    db.add_all(
        [
            GazeSample(
                batch_id=batch.id,
                offset=offset,
                timestamp=sample.timestamp,
                x_normalized=sample.x_normalized,
                y_normalized=sample.y_normalized,
                confidence=sample.confidence,
                scroll_x=sample.scroll_x,
                scroll_y=sample.scroll_y,
                viewport_width=sample.viewport_width,
                viewport_height=sample.viewport_height,
            )
            for offset, sample in enumerate(payload.samples)
        ]
    )
    previous_highest = participant_session.last_sequence_received
    participant_session.last_sequence_received = max(
        previous_highest if previous_highest is not None else -1,
        payload.sequence,
    )
    db.commit()
    db.refresh(batch)
    highest, missing = sequence_state(db, participant_session.id)
    return GazeBatchResponse(
        id=batch.id,
        client_batch_id=batch.client_batch_id,
        sequence=batch.sequence,
        sample_count=batch.sample_count,
        payload_checksum=batch.payload_checksum,
        replayed=False,
        highest_sequence_received=highest,
        missing_sequences=missing,
    )
