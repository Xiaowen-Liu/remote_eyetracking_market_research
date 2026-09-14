from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (
    DUMMY_PASSWORD_HASH,
    hash_session_token,
    issue_session_token,
    verify_password,
)
from ..config import get_settings
from ..database import get_db
from ..dependencies import CurrentOwnerId
from ..errors import ApiError
from ..models import Researcher, ResearcherSession
from ..schemas import ResearcherLogin, ResearcherResponse, ResearcherSessionResponse

router = APIRouter(prefix="/auth", tags=["researcher-auth"])
DbSession = Depends(get_db)


@router.post("/login", response_model=ResearcherSessionResponse, operation_id="loginResearcher")
def login_researcher(
    payload: ResearcherLogin,
    db: Session = DbSession,
) -> ResearcherSessionResponse:
    researcher = db.scalar(
        select(Researcher).where(Researcher.email == payload.email.strip().lower())
    )
    password_valid = verify_password(
        payload.password,
        researcher.password_hash if researcher else DUMMY_PASSWORD_HASH,
    )
    if not researcher or not researcher.active or not password_valid:
        raise ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect")

    raw_token = issue_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=get_settings().researcher_session_hours
    )
    db.add(
        ResearcherSession(
            researcher_id=researcher.id,
            token_hash=hash_session_token(raw_token),
            expires_at=expires_at,
        )
    )
    db.commit()
    return ResearcherSessionResponse(
        access_token=raw_token,
        expires_at=expires_at,
        researcher=researcher,
    )


@router.get("/me", response_model=ResearcherResponse, operation_id="getCurrentResearcher")
def get_current_researcher(
    researcher_id: CurrentOwnerId,
    db: Session = DbSession,
) -> Researcher:
    researcher = db.get(Researcher, researcher_id)
    if not researcher:
        raise ApiError(404, "RESEARCHER_NOT_FOUND", "Researcher account was not found")
    return researcher


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, operation_id="logoutResearcher")
def logout_researcher(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = DbSession,
) -> Response:
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(401, "RESEARCHER_AUTH_REQUIRED", "Use a researcher bearer token")
    raw_token = authorization.removeprefix("Bearer ").strip()
    session = db.scalar(
        select(ResearcherSession).where(
            ResearcherSession.token_hash == hash_session_token(raw_token),
            ResearcherSession.revoked_at.is_(None),
        )
    )
    if not session:
        raise ApiError(
            401,
            "INVALID_RESEARCHER_SESSION",
            "Researcher session is invalid or expired",
        )
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
