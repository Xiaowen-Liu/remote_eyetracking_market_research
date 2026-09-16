import hashlib
import threading
import time
from dataclasses import dataclass

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import Settings
from .errors import request_id


@dataclass
class Window:
    started_at: float
    count: int


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
    limiter = FixedWindowLimiter()
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
        elif request.method == "POST" and path.startswith("/api/v1/participant-sessions"):
            limit = settings.participant_rate_limit_per_minute
            bucket = "participant-write"
            identity = _participant_key(request, settings)

        if limit is not None:
            allowed, retry_after = limiter.consume(f"{bucket}:{identity}", limit)
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
