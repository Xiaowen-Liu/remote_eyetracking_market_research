import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..authorization import require_project_access
from ..database import get_db
from ..dependencies import CurrentOwnerId
from ..errors import ApiError
from ..models import AuditEvent, ProjectMembership, ProjectRole, Researcher, ResearchProject
from ..schemas import (
    AuditEventListResponse,
    ErrorResponse,
    ProjectAccessResponse,
    ProjectCreate,
    ProjectListResponse,
    ProjectMembershipCreate,
    ProjectMembershipListResponse,
    ProjectMembershipResponse,
    ProjectMembershipUpdate,
    ProjectResponse,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])
DbSession = Depends(get_db)


def membership_payload(
    membership: ProjectMembership, researcher: Researcher
) -> ProjectMembershipResponse:
    return ProjectMembershipResponse(
        id=membership.id,
        project_id=membership.project_id,
        researcher=researcher,
        role=membership.role,
        invited_by=membership.invited_by,
        created_at=membership.created_at,
        updated_at=membership.updated_at,
    )


def add_audit_event(
    db: Session,
    *,
    actor_id: uuid.UUID,
    project_id: uuid.UUID,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID,
    metadata: dict[str, object] | None = None,
) -> None:
    db.add(
        AuditEvent(
            actor_id=actor_id,
            project_id=project_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            event_metadata=metadata or {},
        )
    )


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
    db.flush()
    if db.get(Researcher, owner_id):
        db.add(
            ProjectMembership(
                project_id=project.id,
                researcher_id=owner_id,
                role=ProjectRole.OWNER,
                invited_by=owner_id,
            )
        )
    add_audit_event(
        db,
        actor_id=owner_id,
        project_id=project.id,
        action="project.created",
        resource_type="project",
        resource_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=ProjectListResponse, operation_id="listProjects")
def list_projects(owner_id: CurrentOwnerId, db: Session = DbSession) -> ProjectListResponse:
    membership_exists = select(ProjectMembership.id).where(
        ProjectMembership.project_id == ResearchProject.id,
        ProjectMembership.researcher_id == owner_id,
    ).exists()
    access_filter = or_(ResearchProject.owner_id == owner_id, membership_exists)
    projects = list(
        db.scalars(
            select(ResearchProject)
            .where(access_filter)
            .order_by(ResearchProject.updated_at.desc())
        )
    )
    total = db.scalar(
        select(func.count()).select_from(ResearchProject).where(access_filter)
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
    project, _ = require_project_access(db, project_id, owner_id)
    return project


@router.get(
    "/{project_id}/access",
    response_model=ProjectAccessResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="getProjectAccess",
)
def get_project_access(
    project_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> ProjectAccessResponse:
    project, role = require_project_access(db, project_id, owner_id)
    can_edit = role in {ProjectRole.OWNER, ProjectRole.EDITOR}
    is_owner = role == ProjectRole.OWNER
    return ProjectAccessResponse(
        project_id=project.id,
        role=role,
        can_edit=can_edit,
        can_manage_members=is_owner,
        can_delete=is_owner,
    )


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="updateProject",
)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> ResearchProject:
    project, role = require_project_access(db, project_id, owner_id, ProjectRole.EDITOR)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value.strip() if isinstance(value, str) else value)
    add_audit_event(
        db,
        actor_id=owner_id,
        project_id=project.id,
        action="project.updated",
        resource_type="project",
        resource_id=project.id,
        metadata={"role": role.value, "fields": sorted(payload.model_fields_set)},
    )
    db.commit()
    db.refresh(project)
    return project


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="deleteProject",
)
def delete_project(
    project_id: uuid.UUID,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> Response:
    project, _ = require_project_access(db, project_id, owner_id, ProjectRole.OWNER)
    add_audit_event(
        db,
        actor_id=owner_id,
        project_id=project.id,
        action="project.deleted",
        resource_type="project",
        resource_id=project.id,
    )
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{project_id}/members",
    response_model=ProjectMembershipListResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="listProjectMembers",
)
def list_project_members(
    project_id: uuid.UUID,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> ProjectMembershipListResponse:
    require_project_access(db, project_id, owner_id, ProjectRole.OWNER)
    rows = list(
        db.execute(
            select(ProjectMembership, Researcher)
            .join(Researcher, Researcher.id == ProjectMembership.researcher_id)
            .where(ProjectMembership.project_id == project_id)
            .order_by(ProjectMembership.created_at)
        ).all()
    )
    return ProjectMembershipListResponse(
        items=[membership_payload(membership, researcher) for membership, researcher in rows],
        total=len(rows),
    )


@router.post(
    "/{project_id}/members",
    response_model=ProjectMembershipResponse,
    status_code=status.HTTP_201_CREATED,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="addProjectMember",
)
def add_project_member(
    project_id: uuid.UUID,
    payload: ProjectMembershipCreate,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> ProjectMembershipResponse:
    require_project_access(db, project_id, owner_id, ProjectRole.OWNER)
    researcher = db.scalar(
        select(Researcher).where(Researcher.email == payload.email.strip().lower())
    )
    if not researcher or not researcher.active:
        raise ApiError(404, "RESEARCHER_NOT_FOUND", "Researcher account was not found")
    existing = db.scalar(
        select(ProjectMembership).where(
            ProjectMembership.project_id == project_id,
            ProjectMembership.researcher_id == researcher.id,
        )
    )
    if existing:
        raise ApiError(409, "PROJECT_MEMBER_EXISTS", "Researcher is already a project member")
    membership = ProjectMembership(
        project_id=project_id,
        researcher_id=researcher.id,
        role=payload.role,
        invited_by=owner_id,
    )
    db.add(membership)
    db.flush()
    add_audit_event(
        db,
        actor_id=owner_id,
        project_id=project_id,
        action="project.member_added",
        resource_type="project_membership",
        resource_id=membership.id,
        metadata={"researcher_id": str(researcher.id), "role": payload.role.value},
    )
    db.commit()
    db.refresh(membership)
    return membership_payload(membership, researcher)


@router.patch(
    "/{project_id}/members/{membership_id}",
    response_model=ProjectMembershipResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="updateProjectMember",
)
def update_project_member(
    project_id: uuid.UUID,
    membership_id: uuid.UUID,
    payload: ProjectMembershipUpdate,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> ProjectMembershipResponse:
    require_project_access(db, project_id, owner_id, ProjectRole.OWNER)
    membership = db.scalar(
        select(ProjectMembership).where(
            ProjectMembership.id == membership_id,
            ProjectMembership.project_id == project_id,
        )
    )
    if not membership or membership.role == ProjectRole.OWNER:
        raise ApiError(404, "PROJECT_MEMBER_NOT_FOUND", "Project member was not found")
    old_role = membership.role
    membership.role = payload.role
    researcher = db.get(Researcher, membership.researcher_id)
    if not researcher:
        raise ApiError(404, "RESEARCHER_NOT_FOUND", "Researcher account was not found")
    add_audit_event(
        db,
        actor_id=owner_id,
        project_id=project_id,
        action="project.member_role_updated",
        resource_type="project_membership",
        resource_id=membership.id,
        metadata={"from": old_role.value, "to": payload.role.value},
    )
    db.commit()
    db.refresh(membership)
    return membership_payload(membership, researcher)


@router.delete(
    "/{project_id}/members/{membership_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="removeProjectMember",
)
def remove_project_member(
    project_id: uuid.UUID,
    membership_id: uuid.UUID,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> Response:
    require_project_access(db, project_id, owner_id, ProjectRole.OWNER)
    membership = db.scalar(
        select(ProjectMembership).where(
            ProjectMembership.id == membership_id,
            ProjectMembership.project_id == project_id,
            ProjectMembership.role != ProjectRole.OWNER,
        )
    )
    if not membership:
        raise ApiError(404, "PROJECT_MEMBER_NOT_FOUND", "Project member was not found")
    add_audit_event(
        db,
        actor_id=owner_id,
        project_id=project_id,
        action="project.member_removed",
        resource_type="project_membership",
        resource_id=membership.id,
        metadata={
            "researcher_id": str(membership.researcher_id),
            "role": membership.role.value,
        },
    )
    db.delete(membership)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{project_id}/audit-events",
    response_model=AuditEventListResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    operation_id="listProjectAuditEvents",
)
def list_project_audit_events(
    project_id: uuid.UUID,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> AuditEventListResponse:
    require_project_access(db, project_id, owner_id, ProjectRole.OWNER)
    events = list(
        db.scalars(
            select(AuditEvent)
            .where(AuditEvent.project_id == project_id)
            .order_by(AuditEvent.occurred_at.desc())
            .limit(200)
        )
    )
    return AuditEventListResponse(items=events, total=len(events))
