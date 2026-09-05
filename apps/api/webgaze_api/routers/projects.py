import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import CurrentOwnerId
from ..errors import ApiError
from ..models import ResearchProject
from ..schemas import (
    ErrorResponse,
    ProjectCreate,
    ProjectListResponse,
    ProjectResponse,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])
DbSession = Depends(get_db)


def owned_project(db: Session, project_id: uuid.UUID, owner_id: uuid.UUID) -> ResearchProject:
    project = db.scalar(
        select(ResearchProject).where(
            ResearchProject.id == project_id, ResearchProject.owner_id == owner_id
        )
    )
    if not project:
        raise ApiError(404, "PROJECT_NOT_FOUND", "Research project was not found")
    return project


@router.post(
    "",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    responses={422: {"model": ErrorResponse}},
    operation_id="createProject",
)
def create_project(
    payload: ProjectCreate,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> ResearchProject:
    project = ResearchProject(
        owner_id=owner_id,
        name=payload.name.strip(),
        research_question=payload.research_question,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=ProjectListResponse, operation_id="listProjects")
def list_projects(owner_id: CurrentOwnerId, db: Session = DbSession) -> ProjectListResponse:
    projects = list(
        db.scalars(
            select(ResearchProject)
            .where(ResearchProject.owner_id == owner_id)
            .order_by(ResearchProject.updated_at.desc())
        )
    )
    total = db.scalar(
        select(func.count())
        .select_from(ResearchProject)
        .where(ResearchProject.owner_id == owner_id)
    )
    return ProjectListResponse(items=projects, total=total or 0)


@router.get(
    "/{project_id}",
    response_model=ProjectResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="getProject",
)
def get_project(
    project_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> ResearchProject:
    return owned_project(db, project_id, owner_id)


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="updateProject",
)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> ResearchProject:
    project = owned_project(db, project_id, owner_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(project)
    return project


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse}},
    operation_id="deleteProject",
)
def delete_project(
    project_id: uuid.UUID,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> Response:
    project = owned_project(db, project_id, owner_id)
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
