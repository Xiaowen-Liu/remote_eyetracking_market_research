from fastapi import APIRouter

from ..schemas import HealthResponse

router = APIRouter(tags=["operations"])


@router.get("/healthz", response_model=HealthResponse, operation_id="getHealth")
def health() -> HealthResponse:
    return HealthResponse()
