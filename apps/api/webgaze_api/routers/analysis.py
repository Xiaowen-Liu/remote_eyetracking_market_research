import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
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
    ParticipantSession,
    ResearchProject,
    SessionLifecycle,
    Study,
    StudyVersion,
    Task,
)
from ..schemas import (
    AnalysisJobListResponse,
    AnalysisJobResponse,
    AnalysisResultResponse,
    ErrorResponse,
)

router = APIRouter(tags=["analysis"])
DbSession = Depends(get_db)


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
