from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import HealthResponse, ReadinessResponse

router = APIRouter(tags=["operations"])
DbSession = Depends(get_db)


@router.get("/healthz", response_model=HealthResponse, operation_id="getHealth")
def health() -> HealthResponse:
    return HealthResponse()


@router.get("/readyz", response_model=ReadinessResponse, operation_id="getReadiness")
def readiness(db: Session = DbSession) -> ReadinessResponse:
    db.execute(text("SELECT 1"))
    return ReadinessResponse()
