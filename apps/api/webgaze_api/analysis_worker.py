from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .analysis import run_analysis_job
from .models import AnalysisJob, AnalysisStatus

MAX_WORKER_ATTEMPTS = 3
LEASE_SECONDS = 120


def claim_analysis_job(db: Session, *, now: datetime | None = None) -> AnalysisJob | None:
    claimed_at = now or datetime.now(timezone.utc)
    job = db.scalar(
        select(AnalysisJob)
        .where(
            AnalysisJob.dead_lettered_at.is_(None),
            AnalysisJob.available_at <= claimed_at,
            or_(
                AnalysisJob.status == AnalysisStatus.QUEUED,
                (AnalysisJob.status == AnalysisStatus.RUNNING)
                & (AnalysisJob.lease_expires_at < claimed_at),
            ),
        )
        .order_by(AnalysisJob.available_at, AnalysisJob.queued_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if not job:
        return None
    job.status = AnalysisStatus.RUNNING
    job.worker_attempts += 1
    job.started_at = claimed_at
    job.lease_expires_at = claimed_at + timedelta(seconds=LEASE_SECONDS)
    job.error_code = None
    db.commit()
    db.refresh(job)
    return job


def process_claimed_job(db: Session, job: AnalysisJob) -> bool:
    try:
        run_analysis_job(db, job)
        job.lease_expires_at = None
        db.commit()
        return True
    except Exception:
        db.refresh(job)
        now = datetime.now(timezone.utc)
        job.lease_expires_at = None
        if job.worker_attempts >= MAX_WORKER_ATTEMPTS:
            job.status = AnalysisStatus.FAILED
            job.dead_lettered_at = now
        else:
            job.status = AnalysisStatus.QUEUED
            job.available_at = now + timedelta(seconds=2 ** job.worker_attempts * 15)
        db.commit()
        return False
