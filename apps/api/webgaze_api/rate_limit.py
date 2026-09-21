import hashlib
import threading
import time
from dataclasses import dataclass
from typing import Protocol

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, text
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool

from .config import Settings
from .database import SessionLocal
from .errors import request_id
from .models import RateLimitBucket


@dataclass
class Window:
    started_at: float
    count: int


class RateLimiter(Protocol):
    def consume(self, key: str, limit: int, now: float | None = None) -> tuple[bool, int]: ...


class FixedWindowLimiter:
    """Small process-local guard; provider edge limits remain the outer defense."""

    def __init__(self, window_seconds: int = 60) -> None:
        self.window_seconds = window_seconds
        self._windows: dict[str, Window] = {}
        self._lock = threading.Lock()

    def consume(self, key: str, limit: int, now: float | None = None) -> tuple[bool, int]:
        current = time.monotonic() if now is None else now
        with self._lock:
            window = self._windows.get(key)
            if window is None or current - window.started_at >= self.window_seconds:
                self._windows[key] = Window(started_at=current, count=1)
                self._prune(current)
                return True, 0
            if window.count >= limit:
                retry_after = max(1, int(self.window_seconds - (current - window.started_at)) + 1)
                return False, retry_after
            window.count += 1
            return True, 0

    def _prune(self, now: float) -> None:
        if len(self._windows) < 10_000:
            return
        cutoff = now - self.window_seconds
        self._windows = {
            key: window for key, window in self._windows.items() if window.started_at > cutoff
        }


class DatabaseFixedWindowLimiter:
    """Atomic fixed windows shared by every API replica using the same database."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        window_seconds: int = 60,
        prune_every: int = 1_000,
    ) -> None:
        self.session_factory = session_factory
        self.window_seconds = window_seconds
        self.prune_every = prune_every
        self._consumes = 0

    def consume(self, key: str, limit: int, now: float | None = None) -> tuple[bool, int]:
        current = time.time() if now is None else now
        window_id = int(current // self.window_seconds)
        key_digest = hashlib.sha256(key.encode()).hexdigest()
        statement = text(
            """
            INSERT INTO rate_limit_buckets (key_digest, window_id, request_count)
            VALUES (:key_digest, :window_id, 1)
            ON CONFLICT (key_digest, window_id) DO UPDATE
            SET request_count = rate_limit_buckets.request_count + 1
            WHERE rate_limit_buckets.request_count < :request_limit
            RETURNING request_count
            """
        )
        with self.session_factory.begin() as session:
            count = session.execute(
                statement,
                {
                    "key_digest": key_digest,
                    "window_id": window_id,
                    "request_limit": limit,
                },
            ).scalar_one_or_none()
            self._consumes += 1
            if self._consumes % self.prune_every == 0:
                session.execute(
                    delete(RateLimitBucket).where(RateLimitBucket.window_id < window_id - 1)
                )
        retry_after = max(1, int(self.window_seconds - (current % self.window_seconds)))
        return count is not None, 0 if count is not None else retry_after


def _client_key(request: Request, settings: Settings) -> str:
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def _participant_key(request: Request, settings: Settings) -> str:
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        return hashlib.sha256(authorization.encode()).hexdigest()
    return _client_key(request, settings)


def install_rate_limits(app: FastAPI, settings: Settings) -> None:
    database_backend = settings.rate_limit_backend == "database" or (
        settings.rate_limit_backend == "auto" and settings.environment == "production"
    )
    limiter: RateLimiter = (
        DatabaseFixedWindowLimiter(SessionLocal)
        if database_backend
        else FixedWindowLimiter()
    )
    app.state.rate_limiter = limiter

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        if not settings.rate_limit_enabled or request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        limit: int | None = None
        bucket = ""
        identity = ""
        if request.method == "POST" and path == "/api/v1/auth/login":
            limit = settings.login_rate_limit_per_minute
            bucket = "researcher-login"
            identity = _client_key(request, settings)
        elif request.method in {"POST", "PUT"} and path.startswith(
            "/api/v1/participant-sessions"
        ):
            limit = settings.participant_rate_limit_per_minute
            bucket = "participant-write"
            identity = _participant_key(request, settings)

        if limit is not None:
            allowed, retry_after = await run_in_threadpool(
                limiter.consume, f"{bucket}:{identity}", limit
            )
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    headers={
                        "Retry-After": str(retry_after),
                        "X-Request-ID": request_id(request),
                    },
                    content={
                        "error": {
                            "code": "RATE_LIMITED",
                            "message": "Too many requests; retry after the indicated delay",
                            "field": None,
                        },
                        "request_id": request_id(request),
                    },
                )
        return await call_next(request)
