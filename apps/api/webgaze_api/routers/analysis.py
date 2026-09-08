import uuid

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
from ..models import AnalysisJob, ParticipantSession, ResearchProject, Study, StudyVersion
from ..schemas import (
    AnalysisJobListResponse,
    AnalysisJobResponse,
    AnalysisResultResponse,
    ErrorResponse,
)

router = APIRouter(tags=["analysis"])
DbSession = Depends(get_db)


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
