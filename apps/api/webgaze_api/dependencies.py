import uuid
from typing import Annotated

from fastapi import Depends, Header

from .errors import ApiError

DEMO_OWNER_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")


def current_owner_id(
    x_demo_owner_id: Annotated[str | None, Header()] = None,
) -> uuid.UUID:
    """Temporary M1 identity seam; production authentication arrives later."""
    if not x_demo_owner_id:
        return DEMO_OWNER_ID
    try:
        return uuid.UUID(x_demo_owner_id)
    except ValueError as exc:
        raise ApiError(400, "INVALID_OWNER_ID", "X-Demo-Owner-ID must be a UUID") from exc


CurrentOwnerId = Annotated[uuid.UUID, Depends(current_owner_id)]
