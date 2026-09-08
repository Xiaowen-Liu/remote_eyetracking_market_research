import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies import CurrentOwnerId
from ..errors import ApiError
from ..models import (
    AreaOfInterest,
    AuditEvent,
    ParticipantLink,
    ParticipantSession,
    ResearchProject,
    Study,
    StudyLifecycle,
    StudyVersion,
    Task,
)
from ..schemas import (
    ErrorResponse,
    ParticipantLinkResponse,
    PublicStudyProtocol,
    PublicTask,
    PublishResponse,
    StudyCreate,
    StudyDraft,
    StudyDraftResponse,
    StudyListResponse,
    StudySummary,
    StudyVersionResponse,
)

router = APIRouter(tags=["studies"])
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


def owned_study(
    db: Session, study_id: uuid.UUID, owner_id: uuid.UUID, *, lock: bool = False
) -> Study:
    statement = (
        select(Study)
        .join(ResearchProject)
        .where(Study.id == study_id, ResearchProject.owner_id == owner_id)
    )
    if lock:
        statement = statement.with_for_update()
    study = db.scalar(statement)
    if not study:
        raise ApiError(404, "STUDY_NOT_FOUND", "Study was not found")
    return study


def draft_version(db: Session, study_id: uuid.UUID) -> StudyVersion:
    draft = db.scalar(
        select(StudyVersion)
        .where(StudyVersion.study_id == study_id, StudyVersion.version_number == 0)
        .options(selectinload(StudyVersion.tasks).selectinload(Task.areas_of_interest))
    )
    if not draft:
        raise ApiError(409, "DRAFT_NOT_FOUND", "The study has no editable draft")
    return draft


def apply_draft(version: StudyVersion, payload: StudyDraft) -> None:
    version.title = payload.title.strip()
    version.description = payload.description
    version.consent_version = payload.consent_version.strip()
    version.consent_text = payload.consent_text.strip()
    version.target_origins = [str(origin) for origin in payload.target_origins]
    version.calibration_policy = payload.calibration_policy.model_dump(mode="json")
    version.collection_policy = payload.collection_policy.model_dump(mode="json")
    version.retention_days = payload.retention_days
    for item in payload.tasks:
        task = Task(
            position=item.position,
            title=item.title.strip(),
            prompt=item.prompt.strip(),
            start_url=str(item.start_url),
            success_url_pattern=item.success_url_pattern,
            time_limit_ms=item.time_limit_ms,
        )
        task.areas_of_interest = [
            AreaOfInterest(**aoi.model_dump(mode="json")) for aoi in item.areas_of_interest
        ]
        version.tasks.append(task)


def draft_payload(study: Study, version: StudyVersion) -> StudyDraftResponse:
    return StudyDraftResponse(
        id=study.id,
        project_id=study.project_id,
        lifecycle=study.lifecycle,
        draft_revision=study.draft_revision,
        current_published_version=study.current_published_version,
        created_at=study.created_at,
        updated_at=study.updated_at,
        title=version.title,
        description=version.description,
        consent_version=version.consent_version,
        consent_text=version.consent_text,
        target_origins=version.target_origins,
        calibration_policy=version.calibration_policy,
        collection_policy=version.collection_policy,
        retention_days=version.retention_days,
        tasks=version.tasks,
    )


def version_payload(version: StudyVersion) -> StudyVersionResponse:
    return StudyVersionResponse(
        id=version.id,
        study_id=version.study_id,
        version_number=version.version_number,
        source_revision=version.source_revision,
        published_by=version.published_by,
        published_at=version.published_at,
        title=version.title,
        description=version.description,
        consent_version=version.consent_version,
        consent_text=version.consent_text,
        target_origins=version.target_origins,
        calibration_policy=version.calibration_policy,
        collection_policy=version.collection_policy,
        retention_days=version.retention_days,
        tasks=version.tasks,
    )


@router.post(
    "/projects/{project_id}/studies",
    response_model=StudyDraftResponse,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    operation_id="createStudy",
)
def create_study(
    project_id: uuid.UUID,
    payload: StudyCreate,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> StudyDraftResponse:
    owned_project(db, project_id, owner_id)
    study = Study(project_id=project_id, title=payload.title.strip())
    draft = StudyVersion(
        version_number=0,
        source_revision=1,
        title=payload.title.strip(),
        consent_version=payload.consent_version,
        consent_text=payload.consent_text,
        retention_days=payload.retention_days,
    )
    apply_draft(draft, payload)
    study.versions.append(draft)
    db.add(study)
    db.commit()
    db.refresh(study)
    return draft_payload(study, draft_version(db, study.id))


@router.get(
    "/projects/{project_id}/studies",
    response_model=StudyListResponse,
    operation_id="listStudies",
)
def list_studies(
    project_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> StudyListResponse:
    owned_project(db, project_id, owner_id)
    studies = list(
        db.scalars(
            select(Study).where(Study.project_id == project_id).order_by(Study.updated_at.desc())
        )
    )
    return StudyListResponse(items=studies, total=len(studies))


@router.get(
    "/studies/{study_id}/draft",
    response_model=StudyDraftResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="getStudyDraft",
)
def get_study_draft(
    study_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> StudyDraftResponse:
    study = owned_study(db, study_id, owner_id)
    return draft_payload(study, draft_version(db, study_id))


@router.put(
    "/studies/{study_id}/draft",
    response_model=StudyDraftResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    operation_id="replaceStudyDraft",
)
def replace_study_draft(
    study_id: uuid.UUID,
    payload: StudyDraft,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> StudyDraftResponse:
    study = owned_study(db, study_id, owner_id, lock=True)
    if study.lifecycle in {StudyLifecycle.CLOSED, StudyLifecycle.ARCHIVED}:
        raise ApiError(409, "STUDY_NOT_EDITABLE", "Closed or archived studies cannot be edited")
    draft = draft_version(db, study_id)
    study.title = payload.title.strip()
    study.draft_revision += 1
    draft.source_revision = study.draft_revision
    old_tasks = list(draft.tasks)
    draft.tasks.clear()
    for task in old_tasks:
        db.delete(task)
    db.flush()
    apply_draft(draft, payload)
    db.commit()
    db.refresh(study)
    return draft_payload(study, draft_version(db, study_id))


@router.post(
    "/studies/{study_id}/publish",
    response_model=PublishResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    operation_id="publishStudy",
)
def publish_study(
    study_id: uuid.UUID,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> PublishResponse:
    study = owned_study(db, study_id, owner_id, lock=True)
    if study.lifecycle in {StudyLifecycle.CLOSED, StudyLifecycle.ARCHIVED}:
        raise ApiError(
            409, "STUDY_NOT_PUBLISHABLE", "Closed or archived studies cannot be published"
        )
    if not idempotency_key or len(idempotency_key) > 120:
        raise ApiError(400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key is required")
    key_hash = hashlib.sha256(idempotency_key.encode()).hexdigest()

    publish_events = db.scalars(
        select(AuditEvent).where(
            AuditEvent.action == "study.published", AuditEvent.resource_id == study.id
        )
    )
    replay_event = next(
        (
            event
            for event in publish_events
            if event.event_metadata.get("idempotency_key_hash") == key_hash
        ),
        None,
    )
    if replay_event:
        replayed_version = db.scalar(
            select(StudyVersion)
            .where(
                StudyVersion.study_id == study_id,
                StudyVersion.version_number == replay_event.event_metadata["version"],
            )
            .options(selectinload(StudyVersion.tasks).selectinload(Task.areas_of_interest))
        )
        if replayed_version:
            return PublishResponse(
                study=study, version=version_payload(replayed_version), replayed=True
            )

    if study.current_published_version:
        existing = db.scalar(
            select(StudyVersion)
            .where(
                StudyVersion.study_id == study_id,
                StudyVersion.version_number == study.current_published_version,
            )
            .options(selectinload(StudyVersion.tasks).selectinload(Task.areas_of_interest))
        )
        if existing and existing.source_revision == study.draft_revision:
            return PublishResponse(study=study, version=version_payload(existing), replayed=True)

    draft = draft_version(db, study_id)
    next_version = (study.current_published_version or 0) + 1
    published = StudyVersion(
        study_id=study.id,
        version_number=next_version,
        source_revision=study.draft_revision,
        title=draft.title,
        description=draft.description,
        consent_version=draft.consent_version,
        consent_text=draft.consent_text,
        target_origins=draft.target_origins,
        calibration_policy=draft.calibration_policy,
        collection_policy=draft.collection_policy,
        retention_days=draft.retention_days,
        published_by=owner_id,
        published_at=datetime.now(timezone.utc),
    )
    for item in draft.tasks:
        clone = Task(
            position=item.position,
            title=item.title,
            prompt=item.prompt,
            start_url=item.start_url,
            success_url_pattern=item.success_url_pattern,
            time_limit_ms=item.time_limit_ms,
        )
        clone.areas_of_interest = [
            AreaOfInterest(
                label=aoi.label,
                source=aoi.source,
                x=aoi.x,
                y=aoi.y,
                width=aoi.width,
                height=aoi.height,
                selector=aoi.selector,
                page_path=aoi.page_path,
            )
            for aoi in item.areas_of_interest
        ]
        published.tasks.append(clone)
    raw_token = secrets.token_urlsafe(32)
    link = ParticipantLink(
        token_hash=hashlib.sha256(raw_token.encode()).digest(),
        public_code=raw_token,
        max_sessions=None,
    )
    published.participant_links = [link]
    study.versions.append(published)
    study.lifecycle = StudyLifecycle.PUBLISHED
    study.current_published_version = next_version
    db.add(
        AuditEvent(
            actor_id=owner_id,
            action="study.published",
            resource_type="study",
            resource_id=study.id,
            event_metadata={
                "version": next_version,
                "draft_revision": study.draft_revision,
                "idempotency_key_hash": key_hash,
            },
        )
    )
    db.commit()
    db.refresh(study)
    published = db.scalar(
        select(StudyVersion)
        .where(StudyVersion.id == published.id)
        .options(selectinload(StudyVersion.tasks).selectinload(Task.areas_of_interest))
    )
    return PublishResponse(
        study=StudySummary.model_validate(study),
        version=version_payload(published),
        participant_link=ParticipantLinkResponse(
            id=link.id,
            study_version_id=published.id,
            token=raw_token,
            # This is a browser navigation URL, not the API endpoint used to
            # resolve the protocol. Keeping the two paths separate prevents a
            # copied participant link from being served as an API request.
            participant_url=f"/participate/{raw_token}",
        ),
    )


@router.get(
    "/studies/{study_id}/participant-link",
    response_model=ParticipantLinkResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="getActiveParticipantLink",
)
def get_active_participant_link(
    study_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> ParticipantLinkResponse:
    study = owned_study(db, study_id, owner_id)
    if not study.current_published_version:
        raise ApiError(404, "PARTICIPANT_LINK_NOT_FOUND", "No participant link is active")
    link = db.scalar(
        select(ParticipantLink)
        .join(StudyVersion)
        .where(
            StudyVersion.study_id == study.id,
            StudyVersion.version_number == study.current_published_version,
            ParticipantLink.revoked_at.is_(None),
            ParticipantLink.public_code.is_not(None),
        )
        .order_by(ParticipantLink.created_at.desc())
    )
    if not link or not link.public_code:
        raise ApiError(404, "PARTICIPANT_LINK_NOT_FOUND", "No participant link is active")
    return ParticipantLinkResponse(
        id=link.id,
        study_version_id=link.study_version_id,
        token=link.public_code,
        participant_url=f"/participate/{link.public_code}",
    )


@router.get(
    "/participate/{token}",
    response_model=PublicStudyProtocol,
    responses={404: {"model": ErrorResponse}, 410: {"model": ErrorResponse}},
    operation_id="resolveParticipantLink",
)
def resolve_participant_link(token: str, db: Session = DbSession) -> PublicStudyProtocol:
    link = db.scalar(
        select(ParticipantLink)
        .where(ParticipantLink.public_code == token)
        .options(
            selectinload(ParticipantLink.study_version)
            .selectinload(StudyVersion.tasks)
            .selectinload(Task.areas_of_interest),
            selectinload(ParticipantLink.study_version).selectinload(StudyVersion.study),
        )
    )
    if not link:
        raise ApiError(404, "PARTICIPANT_LINK_NOT_FOUND", "Participant link was not found")
    now = datetime.now(timezone.utc)
    if link.revoked_at:
        raise ApiError(410, "PARTICIPANT_LINK_REVOKED", "Participant link was revoked")
    if link.expires_at and link.expires_at <= now:
        raise ApiError(410, "PARTICIPANT_LINK_EXPIRED", "Participant link has expired")
    version = link.study_version
    if version.study.lifecycle in {StudyLifecycle.CLOSED, StudyLifecycle.ARCHIVED}:
        raise ApiError(410, "STUDY_CLOSED", "This study is no longer accepting participants")
    if link.max_sessions is not None:
        sessions = db.scalar(
            select(func.count())
            .select_from(ParticipantSession)
            .where(ParticipantSession.study_version_id == version.id)
        )
        if (sessions or 0) >= link.max_sessions:
            raise ApiError(410, "PARTICIPANT_LINK_AT_CAPACITY", "Participant capacity was reached")
    return PublicStudyProtocol(
        title=version.title,
        consent_version=version.consent_version,
        consent_text=version.consent_text,
        target_origins=version.target_origins,
        calibration_policy=version.calibration_policy,
        collection_policy=version.collection_policy,
        tasks=[
            PublicTask(
                position=task.position,
                title=task.title,
                prompt=task.prompt,
                start_url=task.start_url,
                success_url_pattern=task.success_url_pattern,
                time_limit_ms=task.time_limit_ms,
            )
            for task in version.tasks
        ],
    )


@router.get(
    "/studies/{study_id}/versions/{version_number}",
    response_model=StudyVersionResponse,
    responses={404: {"model": ErrorResponse}},
    operation_id="getStudyVersion",
)
def get_study_version(
    study_id: uuid.UUID,
    version_number: int,
    owner_id: CurrentOwnerId,
    db: Session = DbSession,
) -> StudyVersionResponse:
    owned_study(db, study_id, owner_id)
    if version_number < 1:
        raise ApiError(404, "STUDY_VERSION_NOT_FOUND", "Published study version was not found")
    version = db.scalar(
        select(StudyVersion)
        .where(
            StudyVersion.study_id == study_id,
            StudyVersion.version_number == version_number,
        )
        .options(selectinload(StudyVersion.tasks).selectinload(Task.areas_of_interest))
    )
    if not version:
        raise ApiError(404, "STUDY_VERSION_NOT_FOUND", "Published study version was not found")
    return version_payload(version)


@router.delete(
    "/studies/{study_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse}},
    operation_id="deleteStudy",
)
def delete_study(
    study_id: uuid.UUID, owner_id: CurrentOwnerId, db: Session = DbSession
) -> Response:
    study = owned_study(db, study_id, owner_id)
    db.delete(study)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
