from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .errors import install_error_handlers
from .routers import health, participants, projects, studies


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="WebGaze API",
        summary="Eye-tracking research platform API",
        description=(
            "Versioned REST API for research projects, published eye-tracking "
            "protocols, participant sessions, sample ingestion, and analysis."
        ),
        version="0.2.0",
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Idempotency-Key",
            "X-Request-ID",
            "X-Demo-Owner-ID",
        ],
    )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(projects.router, prefix="/api/v1")
    app.include_router(studies.router, prefix="/api/v1")
    app.include_router(participants.router, prefix="/api/v1")
    return app


app = create_app()
