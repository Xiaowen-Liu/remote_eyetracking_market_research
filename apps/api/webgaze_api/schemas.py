from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from .models import ProjectStatus, StudyLifecycle


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorDetail(ApiModel):
    code: str
    message: str
    field: str | None = None


class ErrorResponse(ApiModel):
    error: ErrorDetail
    request_id: str


class HealthResponse(ApiModel):
    status: Literal["ok"] = "ok"
    service: Literal["webgaze-api"] = "webgaze-api"


class ProjectCreate(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    research_question: str | None = Field(default=None, max_length=4000)


class ProjectUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    research_question: str | None = Field(default=None, max_length=4000)
    status: ProjectStatus | None = None


class ProjectResponse(ApiModel):
    id: UUID
    owner_id: UUID
    name: str
    research_question: str | None
    status: ProjectStatus
    created_at: datetime
    updated_at: datetime


class ProjectListResponse(ApiModel):
    items: list[ProjectResponse]
    total: int


class AreaOfInterestDraft(ApiModel):
    label: str = Field(min_length=1, max_length=120)
    source: Literal["manual", "selector", "imported"]
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    width: float | None = Field(default=None, gt=0, le=1)
    height: float | None = Field(default=None, gt=0, le=1)
    selector: str | None = Field(default=None, max_length=2000)
    page_path: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_source_fields(self) -> "AreaOfInterestDraft":
        if self.source == "manual" and None in (self.x, self.y, self.width, self.height):
            raise ValueError("Manual AOIs require x, y, width, and height")
        if self.source == "selector" and not self.selector:
            raise ValueError("Selector AOIs require selector")
        if self.x is not None and self.width is not None and self.x + self.width > 1:
            raise ValueError("AOI x + width must not exceed 1")
        if self.y is not None and self.height is not None and self.y + self.height > 1:
            raise ValueError("AOI y + height must not exceed 1")
        return self


class TaskDraft(ApiModel):
    position: int = Field(ge=1, le=4)
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=2000)
    start_url: HttpUrl
    success_url_pattern: str | None = Field(default=None, max_length=2000)
    time_limit_ms: int | None = Field(default=None, ge=10_000, le=3_600_000)
    areas_of_interest: list[AreaOfInterestDraft] = Field(default_factory=list, max_length=50)


class CalibrationPolicy(ApiModel):
    minimum_quality: Literal["strong", "variable", "limited"] = "variable"
    allow_retry: bool = True
    maximum_attempts: int = Field(default=3, ge=1, le=10)


class CollectionPolicy(ApiModel):
    screenshots_enabled: bool = False
    sample_interval_ms: int = Field(default=100, ge=25, le=1000)


class StudyDraft(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    consent_version: str = Field(min_length=1, max_length=40)
    consent_text: str = Field(min_length=1, max_length=10_000)
    target_origins: list[HttpUrl] = Field(min_length=1, max_length=10)
    calibration_policy: CalibrationPolicy = Field(default_factory=CalibrationPolicy)
    collection_policy: CollectionPolicy = Field(default_factory=CollectionPolicy)
    retention_days: int = Field(default=30, ge=1, le=365)
    tasks: list[TaskDraft] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def validate_task_positions(self) -> "StudyDraft":
        positions = [task.position for task in self.tasks]
        if len(set(positions)) != len(positions):
            raise ValueError("Task positions must be unique")
        if sorted(positions) != list(range(1, len(positions) + 1)):
            raise ValueError("Task positions must be contiguous starting at 1")
        return self


class StudySummary(ApiModel):
    id: UUID
    project_id: UUID
    title: str
    lifecycle: StudyLifecycle
    draft_revision: int
    current_published_version: int | None
    created_at: datetime
    updated_at: datetime


class OpenApiMetadata(ApiModel):
    schema_version: str = "v1"
    generated_at: datetime
    extensions: dict[str, Any] = Field(default_factory=dict)
