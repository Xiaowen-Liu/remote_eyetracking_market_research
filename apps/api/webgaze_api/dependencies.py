import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_session_token
from .config import get_settings
from .database import get_db
from .errors import ApiError
from .models import Researcher, ResearcherSession

DEMO_OWNER_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")


def current_owner_id(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
    x_demo_owner_id: Annotated[str | None, Header()] = None,
) -> uuid.UUID:
    """Resolve a researcher session, with an explicit non-production demo fallback."""
    settings = get_settings()
    if authorization:
        if not authorization.startswith("Bearer "):
            raise ApiError(401, "RESEARCHER_AUTH_REQUIRED", "Use a researcher bearer token")
        raw_token = authorization.removeprefix("Bearer ").strip()
        now = datetime.now(timezone.utc)
        researcher = db.scalar(
            select(Researcher)
            .join(ResearcherSession, ResearcherSession.researcher_id == Researcher.id)
            .where(
                ResearcherSession.token_hash == hash_session_token(raw_token),
                ResearcherSession.revoked_at.is_(None),
                ResearcherSession.expires_at > now,
                Researcher.active.is_(True),
            )
        )
        if not researcher:
            raise ApiError(
                401,
                "INVALID_RESEARCHER_SESSION",
                "Researcher session is invalid or expired",
            )
        return researcher.id

    if settings.researcher_auth_required:
        raise ApiError(401, "RESEARCHER_AUTH_REQUIRED", "Sign in to access researcher resources")

    if not x_demo_owner_id:
        return DEMO_OWNER_ID
    if settings.environment == "production":
        raise ApiError(401, "RESEARCHER_AUTH_REQUIRED", "Demo owner overrides are disabled")
    try:
        return uuid.UUID(x_demo_owner_id)
    except ValueError as exc:
        raise ApiError(400, "INVALID_OWNER_ID", "X-Demo-Owner-ID must be a UUID") from exc


CurrentOwnerId = Annotated[uuid.UUID, Depends(current_owner_id)]
