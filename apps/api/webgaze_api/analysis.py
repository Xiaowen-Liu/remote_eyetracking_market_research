import uuid
from datetime import datetime, timezone

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .errors import ApiError
from .models import (
    AnalysisJob,
    AnalysisResult,
    AnalysisStatus,
    CalibrationResult,
    GazeSample,
    GazeSampleBatch,
    ParticipantSession,
    ResearchProject,
    Study,
    StudyVersion,
    Task,
    TaskRun,
)
from .schemas import AnalysisJobResponse, AnalysisResultResponse

ALGORITHM_VERSION = "task-metrics-v1"


def analysis_job_payload(job: AnalysisJob) -> AnalysisJobResponse:
    return AnalysisJobResponse(
        id=job.id,
        session_id=job.session_id,
        algorithm_version=job.algorithm_version,
        status=job.status,
        attempt=job.attempt,
        parameters=job.parameters,
        queued_at=job.queued_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        error_code=job.error_code,
    )


def analysis_result_payload(result: AnalysisResult) -> AnalysisResultResponse:
    return AnalysisResultResponse(
        id=result.id,
        job_id=result.job_id,
        session_id=result.session_id,
        quality=result.quality,
        task_metrics=result.task_metrics,
        diagnostics=result.diagnostics,
        created_at=result.created_at,
    )


def owned_analysis_job(db: Session, job_id: uuid.UUID, owner_id: uuid.UUID) -> AnalysisJob:
    job = db.scalar(
        select(AnalysisJob)
        .join(ParticipantSession, ParticipantSession.id == AnalysisJob.session_id)
        .join(StudyVersion, StudyVersion.id == ParticipantSession.study_version_id)
        .join(Study, Study.id == StudyVersion.study_id)
        .join(ResearchProject, ResearchProject.id == Study.project_id)
        .where(AnalysisJob.id == job_id, ResearchProject.owner_id == owner_id)
    )
    if not job:
        raise ApiError(404, "ANALYSIS_JOB_NOT_FOUND", "Analysis job was not found")
    return job


def result_for_job(db: Session, job_id: uuid.UUID) -> AnalysisResult | None:
    return db.scalar(select(AnalysisResult).where(AnalysisResult.job_id == job_id))


def run_task_metrics(db: Session, job: AnalysisJob) -> AnalysisResult:
    """Create one immutable, versioned result from stored participant samples."""
    session = db.get(ParticipantSession, job.session_id)
    if not session:
        raise ApiError(404, "SESSION_NOT_FOUND", "Participant session was not found")

    sample_rows = list(
        db.execute(
            select(GazeSample, GazeSampleBatch.sequence)
            .join(GazeSampleBatch, GazeSampleBatch.id == GazeSample.batch_id)
            .where(GazeSampleBatch.session_id == session.id)
            .order_by(GazeSampleBatch.sequence, GazeSample.offset)
        ).all()
    )
    run_rows = list(
        db.execute(
            select(TaskRun, Task)
            .join(Task, Task.id == TaskRun.task_id)
            .where(TaskRun.session_id == session.id)
            .order_by(Task.position)
        ).all()
    )
    calibration = db.scalar(
        select(CalibrationResult)
        .where(CalibrationResult.session_id == session.id)
        .order_by(desc(CalibrationResult.attempt))
    )

    task_metrics: list[dict] = []
    for run, task in run_rows:
        first = run.first_sequence if run.first_sequence is not None else 0
        last = run.last_sequence if run.last_sequence is not None else -1
        samples = [
            sample for sample, sequence in sample_rows if first <= sequence <= last
        ]
        confidences = [
            float(sample.confidence) for sample in samples if sample.confidence is not None
        ]
        task_metrics.append(
            {
                "task_position": task.position,
                "task_title": task.title,
                "outcome": run.outcome.value,
                "sample_count": len(samples),
                "mean_confidence": round(sum(confidences) / len(confidences), 4)
                if confidences
                else None,
                "centroid": {
                    "x_normalized": round(
                        sum(float(sample.x_normalized) for sample in samples) / len(samples), 4
                    )
                    if samples
                    else None,
                    "y_normalized": round(
                        sum(float(sample.y_normalized) for sample in samples) / len(samples), 4
                    )
                    if samples
                    else None,
                },
                "sequence_range": {"first": run.first_sequence, "last": run.last_sequence},
            }
        )

    quality = {
        "batch_continuity": "complete",
        "calibration_quality": calibration.quality_grade.value if calibration else None,
        "calibration_error_px": float(calibration.error_px)
        if calibration and calibration.error_px is not None
        else None,
    }
    diagnostics = {
        "algorithm_version": job.algorithm_version,
        "sample_count": len(sample_rows),
        "task_run_count": len(run_rows),
        "aggregate_eligible": bool(
            calibration and calibration.quality_grade.value in {"strong", "variable"}
        ),
    }
    return AnalysisResult(
        job_id=job.id,
        session_id=session.id,
        quality=quality,
        task_metrics={"tasks": task_metrics},
        fixations=[],
        aoi_metrics={},
        diagnostics=diagnostics,
    )


def run_analysis_job(db: Session, job: AnalysisJob) -> AnalysisResult:
    existing = result_for_job(db, job.id)
    if existing:
        return existing
    if job.status not in {AnalysisStatus.QUEUED, AnalysisStatus.FAILED}:
        raise ApiError(409, "ANALYSIS_JOB_NOT_RUNNABLE", "Analysis job is already running")

    job.status = AnalysisStatus.RUNNING
    job.started_at = datetime.now(timezone.utc)
    job.error_code = None
    db.flush()
    try:
        result = run_task_metrics(db, job)
    except Exception:
        job.status = AnalysisStatus.FAILED
        job.finished_at = datetime.now(timezone.utc)
        job.error_code = "ANALYSIS_EXECUTION_FAILED"
        db.commit()
        raise
    job.status = AnalysisStatus.SUCCEEDED
    job.finished_at = datetime.now(timezone.utc)
    db.add(result)
    db.commit()
    db.refresh(result)
    return result
