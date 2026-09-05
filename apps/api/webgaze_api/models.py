from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class ProjectStatus(str, enum.Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class StudyLifecycle(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CLOSED = "closed"
    ARCHIVED = "archived"


class SessionLifecycle(str, enum.Enum):
    CREATED = "created"
    CONSENTED = "consented"
    CALIBRATING = "calibrating"
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    SUBMITTED = "submitted"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"
    ABANDONED = "abandoned"


class TaskOutcome(str, enum.Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    TIMED_OUT = "timed_out"


class QualityGrade(str, enum.Enum):
    STRONG = "strong"
    VARIABLE = "variable"
    LIMITED = "limited"
    FAILED = "failed"


class AnalysisStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ResearchProject(TimestampMixin, Base):
    __tablename__ = "research_projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    research_question: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ProjectStatus] = mapped_column(
        Enum(ProjectStatus, native_enum=False), default=ProjectStatus.ACTIVE, nullable=False
    )

    studies: Mapped[list[Study]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Study(TimestampMixin, Base):
    __tablename__ = "studies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("research_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    lifecycle: Mapped[StudyLifecycle] = mapped_column(
        Enum(StudyLifecycle, native_enum=False), default=StudyLifecycle.DRAFT, nullable=False
    )
    draft_revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    current_published_version: Mapped[int | None] = mapped_column(Integer)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[ResearchProject] = relationship(back_populates="studies")
    versions: Mapped[list[StudyVersion]] = relationship(
        back_populates="study", cascade="all, delete-orphan"
    )


class StudyVersion(Base):
    __tablename__ = "study_versions"
    __table_args__ = (UniqueConstraint("study_id", "version_number"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    study_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("studies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    consent_version: Mapped[str] = mapped_column(String(40), nullable=False)
    consent_text: Mapped[str] = mapped_column(Text, nullable=False)
    target_origins: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    calibration_policy: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    collection_policy: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False)
    published_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    study: Mapped[Study] = relationship(back_populates="versions")
    tasks: Mapped[list[Task]] = relationship(
        back_populates="study_version", cascade="all, delete-orphan", order_by="Task.position"
    )


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("study_version_id", "position"),
        CheckConstraint("position >= 1 AND position <= 4", name="ck_task_position_1_4"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    study_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("study_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    start_url: Mapped[str] = mapped_column(Text, nullable=False)
    success_url_pattern: Mapped[str | None] = mapped_column(Text)
    time_limit_ms: Mapped[int | None] = mapped_column(Integer)

    study_version: Mapped[StudyVersion] = relationship(back_populates="tasks")
    areas_of_interest: Mapped[list[AreaOfInterest]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class AreaOfInterest(Base):
    __tablename__ = "areas_of_interest"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    x: Mapped[float | None] = mapped_column(Numeric(8, 7))
    y: Mapped[float | None] = mapped_column(Numeric(8, 7))
    width: Mapped[float | None] = mapped_column(Numeric(8, 7))
    height: Mapped[float | None] = mapped_column(Numeric(8, 7))
    selector: Mapped[str | None] = mapped_column(Text)
    page_path: Mapped[str | None] = mapped_column(Text)

    task: Mapped[Task] = relationship(back_populates="areas_of_interest")


class ParticipantLink(Base):
    __tablename__ = "participant_links"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    study_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("study_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_sessions: Mapped[int | None] = mapped_column(Integer)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ParticipantSession(Base):
    __tablename__ = "participant_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    study_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("study_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    participant_alias: Mapped[str] = mapped_column(String(80), nullable=False)
    lifecycle: Mapped[SessionLifecycle] = mapped_column(
        Enum(SessionLifecycle, native_enum=False), default=SessionLifecycle.CREATED, nullable=False
    )
    consent_version: Mapped[str | None] = mapped_column(String(40))
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    browser_family: Mapped[str | None] = mapped_column(String(40))
    viewport_width: Mapped[int | None] = mapped_column(Integer)
    viewport_height: Mapped[int | None] = mapped_column(Integer)
    device_pixel_ratio: Mapped[float | None] = mapped_column(Numeric(6, 3))
    last_sequence_received: Mapped[int | None] = mapped_column(Integer)
    retention_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CalibrationResult(Base):
    __tablename__ = "calibration_results"
    __table_args__ = (UniqueConstraint("session_id", "attempt"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participant_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    target_count: Mapped[int] = mapped_column(Integer, nullable=False)
    observed_sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    error_px: Mapped[float | None] = mapped_column(Numeric(10, 3))
    quality_grade: Mapped[QualityGrade] = mapped_column(
        Enum(QualityGrade, native_enum=False), nullable=False
    )
    diagnostics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class TaskRun(Base):
    __tablename__ = "task_runs"
    __table_args__ = (
        Index(
            "uq_one_running_task_per_session",
            "session_id",
            unique=True,
            postgresql_where=text("outcome = 'RUNNING'"),
            sqlite_where=text("outcome = 'RUNNING'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participant_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    outcome: Mapped[TaskOutcome] = mapped_column(
        Enum(TaskOutcome, native_enum=False), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_sequence: Mapped[int | None] = mapped_column(Integer)
    last_sequence: Mapped[int | None] = mapped_column(Integer)


class SessionEvent(Base):
    __tablename__ = "session_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participant_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("task_runs.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class GazeSampleBatch(Base):
    __tablename__ = "gaze_sample_batches"
    __table_args__ = (
        UniqueConstraint("session_id", "sequence"),
        UniqueConstraint("session_id", "client_batch_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    client_batch_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participant_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[str] = mapped_column(String(20), nullable=False)
    captured_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    captured_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    payload_checksum: Mapped[str] = mapped_column(String(64), nullable=False)


class GazeSample(Base):
    __tablename__ = "gaze_samples"
    __table_args__ = (UniqueConstraint("batch_id", "offset"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gaze_sample_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    offset: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    x_normalized: Mapped[float] = mapped_column(Numeric(8, 7), nullable=False)
    y_normalized: Mapped[float] = mapped_column(Numeric(8, 7), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Numeric(6, 5))
    scroll_x: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    scroll_y: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    viewport_width: Mapped[int] = mapped_column(Integer, nullable=False)
    viewport_height: Mapped[int] = mapped_column(Integer, nullable=False)


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    __table_args__ = (UniqueConstraint("session_id", "algorithm_version", "attempt"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participant_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    algorithm_version: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[AnalysisStatus] = mapped_column(
        Enum(AnalysisStatus, native_enum=False), default=AnalysisStatus.QUEUED, nullable=False
    )
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(80))


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participant_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quality: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    task_metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    fixations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    aoi_metrics: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    diagnostics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    event_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, default=dict, nullable=False
    )
