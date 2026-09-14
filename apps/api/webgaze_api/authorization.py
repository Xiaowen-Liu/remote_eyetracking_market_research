import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import ApiError
from .models import (
    AnalysisJob,
    ParticipantSession,
    ProjectMembership,
    ProjectRole,
    ResearchProject,
    Study,
    StudyVersion,
)

ROLE_RANK = {
    ProjectRole.VIEWER: 1,
    ProjectRole.EDITOR: 2,
    ProjectRole.OWNER: 3,
}


def effective_project_role(
    db: Session,
    project: ResearchProject,
    researcher_id: uuid.UUID,
) -> ProjectRole | None:
    if project.owner_id == researcher_id:
        return ProjectRole.OWNER
    return db.scalar(
        select(ProjectMembership.role).where(
            ProjectMembership.project_id == project.id,
            ProjectMembership.researcher_id == researcher_id,
        )
    )


def require_project_access(
    db: Session,
    project_id: uuid.UUID,
    researcher_id: uuid.UUID,
    minimum_role: ProjectRole = ProjectRole.VIEWER,
) -> tuple[ResearchProject, ProjectRole]:
    project = db.get(ResearchProject, project_id)
    role = effective_project_role(db, project, researcher_id) if project else None
    if not project or role is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "Research project was not found")
    if ROLE_RANK[role] < ROLE_RANK[minimum_role]:
        raise ApiError(
            403,
            "PROJECT_ROLE_REQUIRED",
            f"This action requires the {minimum_role.value} role or higher",
        )
    return project, role


def require_study_access(
    db: Session,
    study_id: uuid.UUID,
    researcher_id: uuid.UUID,
    minimum_role: ProjectRole = ProjectRole.VIEWER,
    *,
    lock: bool = False,
) -> tuple[Study, ProjectRole]:
    statement = select(Study).where(Study.id == study_id)
    if lock:
        statement = statement.with_for_update()
    study = db.scalar(statement)
    if not study:
        raise ApiError(404, "STUDY_NOT_FOUND", "Study was not found")
    try:
        _, role = require_project_access(
            db, study.project_id, researcher_id, minimum_role
        )
    except ApiError as error:
        if error.status_code == 404:
            raise ApiError(404, "STUDY_NOT_FOUND", "Study was not found") from error
        raise
    return study, role


def require_analysis_job_access(
    db: Session,
    job_id: uuid.UUID,
    researcher_id: uuid.UUID,
    minimum_role: ProjectRole = ProjectRole.VIEWER,
) -> tuple[AnalysisJob, ProjectRole]:
    row = db.execute(
        select(AnalysisJob, Study.project_id)
        .join(ParticipantSession, ParticipantSession.id == AnalysisJob.session_id)
        .join(StudyVersion, StudyVersion.id == ParticipantSession.study_version_id)
        .join(Study, Study.id == StudyVersion.study_id)
        .where(AnalysisJob.id == job_id)
    ).one_or_none()
    if not row:
        raise ApiError(404, "ANALYSIS_JOB_NOT_FOUND", "Analysis job was not found")
    job, project_id = row
    try:
        _, role = require_project_access(
            db, project_id, researcher_id, minimum_role
        )
    except ApiError as error:
        if error.status_code == 404:
            raise ApiError(
                404, "ANALYSIS_JOB_NOT_FOUND", "Analysis job was not found"
            ) from error
        raise
    return job, role
