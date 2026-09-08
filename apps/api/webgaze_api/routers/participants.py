import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..errors import ApiError
from ..models import ParticipantLink, ParticipantSession, SessionLifecycle, StudyLifecycle
from ..schemas import (
    ConsentCreate,
    ConsentResponse,
    ErrorResponse,
    ParticipantSessionCreate,
    ParticipantSessionResponse,
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
