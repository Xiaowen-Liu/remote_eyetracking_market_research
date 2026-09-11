from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from .models import (
    AnalysisStatus,
    ProjectStatus,
    QualityGrade,
    SessionLifecycle,
    StudyLifecycle,
    TaskOutcome,
)


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
    webcam_gaze_enabled: bool = False


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


class StudyCreate(StudyDraft):
    pass


class StudyListResponse(ApiModel):
    items: list[StudySummary]
    total: int


class StudyDraftResponse(StudyDraft):
    id: UUID
    project_id: UUID
    lifecycle: StudyLifecycle
    draft_revision: int
    current_published_version: int | None
    created_at: datetime
    updated_at: datetime


class StudyVersionResponse(StudyDraft):
    id: UUID
    study_id: UUID
    version_number: int
    source_revision: int
    published_by: UUID
    published_at: datetime


class ParticipantLinkResponse(ApiModel):
    id: UUID
    study_version_id: UUID
    token: str
    participant_url: str


class PublishResponse(ApiModel):
    study: StudySummary
    version: StudyVersionResponse
    participant_link: ParticipantLinkResponse | None = None
    replayed: bool = False


class PublicTask(ApiModel):
    position: int
    title: str
    prompt: str
    start_url: HttpUrl
    success_url_pattern: str | None
    time_limit_ms: int | None


class PublicStudyProtocol(ApiModel):
    title: str
    consent_version: str
    consent_text: str
    target_origins: list[HttpUrl]
    calibration_policy: CalibrationPolicy
    collection_policy: CollectionPolicy
    tasks: list[PublicTask]


class ParticipantSessionCreate(ApiModel):
    browser_family: str | None = Field(default=None, max_length=40)
    viewport_width: int = Field(ge=320, le=10_000)
    viewport_height: int = Field(ge=320, le=10_000)
    device_pixel_ratio: float = Field(default=1, ge=0.5, le=10)


class ParticipantSessionResponse(ApiModel):
    id: UUID
    lifecycle: SessionLifecycle
    participant_alias: str
    access_token: str | None = None
    retention_expires_at: datetime


class ConsentCreate(ApiModel):
    accepted: Literal[True]
    consent_version: str = Field(min_length=1, max_length=40)


class ConsentResponse(ApiModel):
    session_id: UUID
    lifecycle: SessionLifecycle
    consent_version: str
    consented_at: datetime


class CalibrationResultCreate(ApiModel):
    attempt: int = Field(ge=1, le=10)
    started_at: datetime
    completed_at: datetime
    target_count: int = Field(ge=1, le=100)
    observed_sample_count: int = Field(ge=0, le=100_000)
    error_px: float | None = Field(default=None, ge=0, le=100_000)
    quality_grade: QualityGrade
    diagnostics: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_calibration_timing(self) -> "CalibrationResultCreate":
        if self.completed_at < self.started_at:
            raise ValueError("Calibration completion cannot precede its start")
        if self.quality_grade != QualityGrade.FAILED and self.error_px is None:
            raise ValueError("A completed calibration requires an accuracy error")
        return self


class CalibrationResultResponse(ApiModel):
    id: UUID
    session_id: UUID
    attempt: int
    lifecycle: SessionLifecycle
    target_count: int
    observed_sample_count: int
    error_px: float | None
    quality_grade: QualityGrade
    accepted: bool
    attempts_remaining: int


class TaskRunCreate(ApiModel):
    task_position: int = Field(ge=1, le=4)


class TaskRunComplete(ApiModel):
    outcome: Literal[TaskOutcome.COMPLETED, TaskOutcome.SKIPPED, TaskOutcome.TIMED_OUT]


class TaskRunResponse(ApiModel):
    id: UUID
    session_id: UUID
    task_position: int
    outcome: TaskOutcome
    started_at: datetime
    ended_at: datetime | None
    first_sequence: int | None
    last_sequence: int | None
    session_lifecycle: SessionLifecycle


class GazeSampleCreate(ApiModel):
    timestamp: datetime
    x_normalized: float = Field(ge=0, le=1, allow_inf_nan=False)
    y_normalized: float = Field(ge=0, le=1, allow_inf_nan=False)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    scroll_x: float = Field(default=0, allow_inf_nan=False)
    scroll_y: float = Field(default=0, allow_inf_nan=False)
    viewport_width: int = Field(ge=1, le=10_000)
    viewport_height: int = Field(ge=1, le=10_000)


class GazeBatchCreate(ApiModel):
    client_batch_id: UUID
    sequence: int = Field(ge=0)
    schema_version: Literal["1.0"] = "1.0"
    captured_from: datetime
    captured_to: datetime
    samples: list[GazeSampleCreate] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def validate_batch_timing(self) -> "GazeBatchCreate":
        if self.captured_to < self.captured_from:
            raise ValueError("Batch end cannot precede its start")
        if any(
            sample.timestamp < self.captured_from or sample.timestamp > self.captured_to
            for sample in self.samples
        ):
            raise ValueError("Every sample timestamp must fall inside the batch interval")
        return self


class GazeBatchResponse(ApiModel):
    id: UUID
    client_batch_id: UUID
    sequence: int
    sample_count: int
    payload_checksum: str
    replayed: bool
    highest_sequence_received: int
    missing_sequences: list[int]


class AnalysisJobResponse(ApiModel):
    id: UUID
    session_id: UUID
    algorithm_version: str
    status: AnalysisStatus
    attempt: int
    parameters: dict[str, Any]
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_code: str | None


class AnalysisJobListResponse(ApiModel):
    items: list[AnalysisJobResponse]
    total: int


class SessionTimelineEvent(ApiModel):
    kind: str
    occurred_at: datetime


class ParticipantSessionSummary(ApiModel):
    id: UUID
    participant_alias: str
    lifecycle: SessionLifecycle
    created_at: datetime
    consented_at: datetime | None
    submitted_at: datetime | None
    calibration_quality: QualityGrade | None
    calibration_error_px: float | None
    completed_task_count: int
    gaze_batch_count: int
    gaze_sample_count: int
    analysis_status: AnalysisStatus | None
    source: str
    events: list[SessionTimelineEvent]


class ParticipantSessionSummaryListResponse(ApiModel):
    items: list[ParticipantSessionSummary]
    total: int


class SessionSubmitResponse(ApiModel):
    session_id: UUID
    lifecycle: SessionLifecycle
    analysis_job: AnalysisJobResponse
    replayed: bool


class AnalysisResultResponse(ApiModel):
    id: UUID
    job_id: UUID
    session_id: UUID
    quality: dict[str, Any]
    task_metrics: dict[str, Any]
    diagnostics: dict[str, Any]
    created_at: datetime


class OpenApiMetadata(ApiModel):
    schema_version: str = "v1"
    generated_at: datetime
    extensions: dict[str, Any] = Field(default_factory=dict)
