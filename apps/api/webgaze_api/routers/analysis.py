import csv
import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..analysis import (
    analysis_job_payload,
    analysis_result_payload,
    owned_analysis_job,
    result_for_job,
    run_analysis_job,
)
from ..database import get_db
from ..dependencies import CurrentOwnerId
from ..errors import ApiError
from ..models import (
    AnalysisJob,
    AnalysisResult,
    AnalysisStatus,
    AuditEvent,
    CalibrationResult,
    GazeSampleBatch,
    ParticipantSession,
    ResearchProject,
    SessionEvent,
    SessionLifecycle,
    Study,
    StudyVersion,
    Task,
    TaskRun,
)
from ..schemas import (
    AnalysisJobListResponse,
    AnalysisJobResponse,
    AnalysisResultResponse,
    ErrorResponse,
    ParticipantSessionSummary,
    ParticipantSessionSummaryListResponse,
    SessionTimelineEvent,
)

router = APIRouter(tags=["analysis"])
DbSession = Depends(get_db)


def export_filename(job: AnalysisJob, extension: str) -> str:
    return f"webgaze-analysis-{job.id}.{extension}"


def task_rows(result: AnalysisResult) -> list[dict[str, object]]:
    source = result.diagnostics.get("source", "participant-session")
    rows: list[dict[str, object]] = []
    for metric in result.task_metrics.get("tasks", []):
        centroid = metric.get("centroid") or {}
        rows.append(
            {
                "result_id": str(result.id),
                "source": source,
                "task_position": metric.get("task_position"),
                "task_title": metric.get("task_title"),
                "outcome": metric.get("outcome"),
                "sample_count": metric.get("sample_count"),
                "mean_confidence": metric.get("mean_confidence"),
                "centroid_x_normalized": centroid.get("x_normalized"),
                "centroid_y_normalized": centroid.get("y_normalized"),
            }
        )
    return rows


@router.post(
    "/studies/{study_id}/synthetic-results",
    response_model=AnalysisResultResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    operation_id="createSyntheticStudyResults",
)
def create_synthetic_study_results(
    study_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> AnalysisResultResponse:
    study = db.scalar(
        select(Study)
        .join(ResearchProject)
        .where(Study.id == study_id, ResearchProject.owner_id == owner_id)
    )
    if not study:
        raise ApiError(404, "STUDY_NOT_FOUND", "Study was not found")
    if not study.current_published_version:
        raise ApiError(409, "STUDY_NOT_PUBLISHED", "Publish the study before loading demo results")
    version = db.scalar(
        select(StudyVersion).where(
            StudyVersion.study_id == study.id,
            StudyVersion.version_number == study.current_published_version,
        )
    )
    if not version:
        raise ApiError(409, "PUBLISHED_VERSION_NOT_FOUND", "Published study version was not found")
    existing = db.scalar(
        select(AnalysisResult)
        .join(AnalysisJob, AnalysisJob.id == AnalysisResult.job_id)
        .join(ParticipantSession, ParticipantSession.id == AnalysisJob.session_id)
        .where(
            ParticipantSession.study_version_id == version.id,
            ParticipantSession.participant_alias == "Synthetic demo participant",
        )
    )
    if existing:
        return analysis_result_payload(existing)

    now = datetime.now(timezone.utc)
    session = ParticipantSession(
        study_version_id=version.id,
        participant_alias="Synthetic demo participant",
        lifecycle=SessionLifecycle.SUBMITTED,
        consent_version=version.consent_version,
        consented_at=now,
        started_at=now,
        submitted_at=now,
        browser_family="Synthetic demo",
        viewport_width=1440,
        viewport_height=900,
        device_pixel_ratio=2,
        retention_expires_at=now + timedelta(days=version.retention_days),
    )
    db.add(session)
    db.flush()
    job = AnalysisJob(
        session_id=session.id,
        algorithm_version="synthetic-demo-v1",
        status=AnalysisStatus.SUCCEEDED,
        attempt=1,
        parameters={"source": "synthetic-demo", "raw_gaze_samples": False},
        started_at=now,
        finished_at=now,
    )
    db.add(job)
    db.flush()
    tasks = list(
        db.scalars(select(Task).where(Task.study_version_id == version.id).order_by(Task.position))
    )
    metrics = [
        {
            "task_position": task.position,
            "task_title": task.title,
            "outcome": "completed",
            "sample_count": 42 + task.position * 7,
            "mean_confidence": round(0.83 + task.position * 0.02, 2),
            "centroid": {
                "x_normalized": round(0.28 + task.position * 0.12, 2),
                "y_normalized": round(0.42 + task.position * 0.08, 2),
            },
            "sequence_range": {"first": (task.position - 1) * 2, "last": task.position * 2 - 1},
        }
        for task in tasks
    ]
    result = AnalysisResult(
        job_id=job.id,
        session_id=session.id,
        quality={
            "batch_continuity": "synthetic",
            "calibration_quality": "strong",
            "calibration_error_px": 41.0,
        },
        task_metrics={"tasks": metrics},
        fixations=[],
        aoi_metrics={},
        diagnostics={
            "source": "synthetic-demo",
            "disclosure": "Generated demo data; not collected from a person or camera.",
            "sample_count": sum(metric["sample_count"] for metric in metrics),
            "task_run_count": len(metrics),
            "aggregate_eligible": False,
        },
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return analysis_result_payload(result)


@router.get(
    "/studies/{study_id}/analysis-jobs",
    response_model=AnalysisJobListResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="listStudyAnalysisJobs",
)
def list_study_analysis_jobs(
    study_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> AnalysisJobListResponse:
    query = (
        select(AnalysisJob)
        .join(ParticipantSession, ParticipantSession.id == AnalysisJob.session_id)
        .join(StudyVersion, StudyVersion.id == ParticipantSession.study_version_id)
        .join(Study, Study.id == StudyVersion.study_id)
        .join(ResearchProject, ResearchProject.id == Study.project_id)
        .where(Study.id == study_id, ResearchProject.owner_id == owner_id)
        .order_by(AnalysisJob.queued_at.desc())
    )
    jobs = list(db.scalars(query))
    if not jobs:
        study_exists = db.scalar(
            select(Study.id)
            .join(ResearchProject)
            .where(Study.id == study_id, ResearchProject.owner_id == owner_id)
        )
        if not study_exists:
            raise ApiError(404, "STUDY_NOT_FOUND", "Study was not found")
    return AnalysisJobListResponse(
        items=[analysis_job_payload(job) for job in jobs], total=len(jobs)
    )


@router.get(
    "/studies/{study_id}/participant-sessions",
    response_model=ParticipantSessionSummaryListResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="listStudyParticipantSessions",
)
def list_study_participant_sessions(
    study_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> ParticipantSessionSummaryListResponse:
    study = db.scalar(
        select(Study)
        .join(ResearchProject)
        .where(Study.id == study_id, ResearchProject.owner_id == owner_id)
    )
    if not study:
        raise ApiError(404, "STUDY_NOT_FOUND", "Study was not found")
    sessions = list(
        db.scalars(
            select(ParticipantSession)
            .join(StudyVersion, StudyVersion.id == ParticipantSession.study_version_id)
            .where(StudyVersion.study_id == study.id)
            .order_by(ParticipantSession.created_at.desc())
        )
    )
    items: list[ParticipantSessionSummary] = []
    for session in sessions:
        calibration = db.scalar(
            select(CalibrationResult)
            .where(CalibrationResult.session_id == session.id)
            .order_by(CalibrationResult.attempt.desc())
        )
        completed_task_count = db.scalar(
            select(func.count()).select_from(TaskRun).where(
                TaskRun.session_id == session.id, TaskRun.ended_at.is_not(None)
            )
        ) or 0
        gaze_batch_count, gaze_sample_count = db.execute(
            select(func.count(GazeSampleBatch.id), func.coalesce(func.sum(GazeSampleBatch.sample_count), 0))
            .where(GazeSampleBatch.session_id == session.id)
        ).one()
        job = db.scalar(
            select(AnalysisJob).where(AnalysisJob.session_id == session.id).order_by(AnalysisJob.queued_at.desc())
        )
        events = list(
            db.scalars(
                select(SessionEvent)
                .where(SessionEvent.session_id == session.id)
                .order_by(SessionEvent.occurred_at.desc())
                .limit(6)
            )
        )
        items.append(ParticipantSessionSummary(
            id=session.id,
            participant_alias=session.participant_alias,
            lifecycle=session.lifecycle,
            created_at=session.created_at,
            consented_at=session.consented_at,
            submitted_at=session.submitted_at,
            calibration_quality=calibration.quality_grade if calibration else None,
            calibration_error_px=float(calibration.error_px) if calibration and calibration.error_px is not None else None,
            completed_task_count=completed_task_count,
            gaze_batch_count=gaze_batch_count,
            gaze_sample_count=gaze_sample_count,
            analysis_status=job.status if job else None,
            source="synthetic-demo" if session.participant_alias == "Synthetic demo participant" else "participant-session",
            events=[SessionTimelineEvent(kind=event.kind, occurred_at=event.occurred_at) for event in events],
        ))
    return ParticipantSessionSummaryListResponse(items=items, total=len(items))


@router.get(
    "/analysis-jobs/{job_id}",
    response_model=AnalysisJobResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="getAnalysisJob",
)
def get_analysis_job(
    job_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> AnalysisJobResponse:
    return analysis_job_payload(owned_analysis_job(db, job_id, owner_id))


@router.post(
    "/analysis-jobs/{job_id}/run",
    response_model=AnalysisResultResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    operation_id="runAnalysisJob",
)
def run_analysis(
    job_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> AnalysisResultResponse:
    job = owned_analysis_job(db, job_id, owner_id)
    return analysis_result_payload(run_analysis_job(db, job))


@router.get(
    "/analysis-jobs/{job_id}/result",
    response_model=AnalysisResultResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    operation_id="getAnalysisResult",
)
def get_analysis_result(
    job_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> AnalysisResultResponse:
    job = owned_analysis_job(db, job_id, owner_id)
    result = result_for_job(db, job.id)
    if not result:
        raise ApiError(409, "ANALYSIS_RESULT_PENDING", "Analysis has not completed")
    return analysis_result_payload(result)


@router.get(
    "/analysis-jobs/{job_id}/export",
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    operation_id="exportAnalysisResult",
)
def export_analysis_result(
    job_id: uuid.UUID,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
    format: Literal["json", "csv"] = "json",
) -> Response:
    job = owned_analysis_job(db, job_id, owner_id)
    result = result_for_job(db, job.id)
    if not result:
        raise ApiError(409, "ANALYSIS_RESULT_PENDING", "Analysis has not completed")
    db.add(
        AuditEvent(
            actor_id=owner_id,
            action="analysis.exported",
            resource_type="analysis_result",
            resource_id=result.id,
            event_metadata={"format": format, "source": result.diagnostics.get("source")},
        )
    )
    db.commit()
    if format == "csv":
        buffer = io.StringIO()
        fieldnames = [
            "result_id",
            "source",
            "task_position",
            "task_title",
            "outcome",
            "sample_count",
            "mean_confidence",
            "centroid_x_normalized",
            "centroid_y_normalized",
        ]
        writer = csv.DictWriter(buffer, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(task_rows(result))
        return StreamingResponse(
            iter([buffer.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{export_filename(job, "csv")}"'
            },
        )
    payload = {
        "schema_version": "analysis-export-v1",
        "job": analysis_job_payload(job).model_dump(mode="json"),
        "result": analysis_result_payload(result).model_dump(mode="json"),
        "task_metrics": task_rows(result),
    }
    return Response(
        json.dumps(payload, sort_keys=True),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{export_filename(job, "json")}"'},
    )
