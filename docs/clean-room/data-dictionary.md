# Clean-room data dictionary

Status: proposed domain model; implementation-independent
Date: 2026-09-04

## Conventions

- IDs are opaque UUIDs unless the API explicitly uses a public token.
- Timestamps are UTC ISO 8601 at API boundaries and timezone-aware in storage.
- Durations use integer milliseconds.
- Normalized coordinates use the inclusive range `0..1`.
- Raw access tokens are returned once and stored only as hashes.
- Mutable rows include optimistic-lock or update-version metadata.
- Deletion and retention rules apply to derived results as well as raw samples.

## ResearchProject

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Internal project identifier |
| `owner_id` | UUID | yes | Researcher who owns the project |
| `name` | string | yes | Research-facing project name |
| `research_question` | text | no | Intended question, not shown to participants by default |
| `status` | enum | yes | `active` or `archived` |
| `created_at` | timestamp | yes | Creation time |
| `updated_at` | timestamp | yes | Last metadata change |

## Study

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Stable study identity across revisions |
| `project_id` | UUID | yes | Parent project |
| `title` | string | yes | Research-facing study title |
| `lifecycle` | enum | yes | `draft`, `published`, `closed`, or `archived` |
| `draft_revision` | integer | yes | Optimistic concurrency value for draft editing |
| `current_published_version` | integer | no | Latest published version number |
| `created_at` | timestamp | yes | Creation time |
| `updated_at` | timestamp | yes | Last metadata change |
| `closed_at` | timestamp | no | Time new sessions stopped |

## StudyVersion

Immutable after creation.

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Version row identifier |
| `study_id` | UUID | yes | Stable study identity |
| `version_number` | integer | yes | Monotonic number unique within the study |
| `title` | string | yes | Participant-facing title snapshot |
| `description` | text | no | Participant-facing description snapshot |
| `consent_version` | string | yes | Consent copy identifier |
| `consent_text` | text | yes | Exact displayed consent snapshot |
| `target_origins` | string[] | yes | Allowed task origins |
| `calibration_policy` | JSON object | yes | Public, documented calibration settings |
| `collection_policy` | JSON object | yes | Screenshot and sample settings |
| `retention_days` | integer | yes | Participant-data retention period |
| `published_by` | UUID | yes | Publishing researcher |
| `published_at` | timestamp | yes | Publication time |

Database invariant: `(study_id, version_number)` is unique.

## Task

A published task belongs to a `StudyVersion`; draft tasks use a separate draft
representation or editing table.

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Task identity within one version |
| `study_version_id` | UUID | yes | Immutable protocol version |
| `position` | integer | yes | Order from 1 through 4 |
| `title` | string | yes | Short researcher and participant label |
| `prompt` | text | yes | Plain-text instruction |
| `start_url` | URL | yes | Initial task page |
| `success_url_pattern` | string | no | Optional declarative completion signal |
| `time_limit_ms` | integer | no | Optional maximum task duration |

Database invariants: positions are unique within a version; each version has
between one and four tasks.

## AreaOfInterest

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | AOI identity |
| `task_id` | UUID | yes | Task-scoped ownership |
| `label` | string | yes | Human-readable label |
| `source` | enum | yes | `manual`, `selector`, or `imported` |
| `x` | decimal | conditional | Normalized left position |
| `y` | decimal | conditional | Normalized top position |
| `width` | decimal | conditional | Normalized width |
| `height` | decimal | conditional | Normalized height |
| `selector` | string | conditional | Optional stable DOM selector strategy |
| `page_path` | string | no | URL-path scope |

Rectangle fields are required for manual AOIs. Selector-based AOIs store the
resolved rectangle as session evidence rather than silently assuming stability.

## ParticipantLink

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Internal link identifier |
| `study_version_id` | UUID | yes | Version participants will execute |
| `token_hash` | bytes/string | yes | Hash of high-entropy public token |
| `expires_at` | timestamp | no | Optional expiry |
| `max_sessions` | integer | no | Optional capacity |
| `revoked_at` | timestamp | no | Revocation time |
| `created_at` | timestamp | yes | Creation time |

The raw token is not logged and is not retrievable after creation.

## ParticipantSession

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Internal session identifier |
| `study_version_id` | UUID | yes | Frozen protocol executed |
| `participant_alias` | string | yes | Non-identifying research label |
| `lifecycle` | enum | yes | Current session state |
| `consent_version` | string | no | Accepted consent identifier |
| `consented_at` | timestamp | no | Consent time |
| `started_at` | timestamp | no | Collection start |
| `submitted_at` | timestamp | no | Submission time |
| `withdrawn_at` | timestamp | no | Withdrawal time |
| `browser_family` | string | no | Coarse diagnostic value |
| `viewport_width` | integer | no | CSS-pixel width |
| `viewport_height` | integer | no | CSS-pixel height |
| `device_pixel_ratio` | decimal | no | Coordinate interpretation aid |
| `last_sequence_received` | integer | no | Ingestion diagnostic only |
| `retention_expires_at` | timestamp | yes | Scheduled deletion deadline |

Do not store name, email, IP address, webcam frames, or raw user-agent data
unless a later product requirement has a documented privacy justification.

## CalibrationResult

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Calibration attempt identifier |
| `session_id` | UUID | yes | Participant session |
| `attempt` | integer | yes | Attempt number |
| `started_at` | timestamp | yes | Attempt start |
| `completed_at` | timestamp | no | Attempt completion |
| `target_count` | integer | yes | Known validation targets |
| `observed_sample_count` | integer | yes | Samples used for validation |
| `error_px` | decimal | no | Documented screen-space error summary |
| `quality_grade` | enum | yes | `strong`, `variable`, `limited`, or `failed` |
| `diagnostics` | JSON object | yes | Non-image diagnostic details |

## TaskRun

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | One execution of one task |
| `session_id` | UUID | yes | Participant session |
| `task_id` | UUID | yes | Published task |
| `outcome` | enum | yes | `running`, `completed`, `skipped`, or `timed_out` |
| `started_at` | timestamp | yes | Explicit participant start |
| `ended_at` | timestamp | no | Explicit or automatic end |
| `first_sequence` | integer | no | First overlapping sample batch |
| `last_sequence` | integer | no | Last overlapping sample batch |

Only one task run may be `running` in a session.

## SessionEvent

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Event identity |
| `session_id` | UUID | yes | Participant session |
| `task_run_id` | UUID | no | Optional task context |
| `kind` | enum | yes | Navigation, scroll, resize, pause, resume, warning, or lifecycle event |
| `occurred_at` | timestamp | yes | Client-observed time |
| `payload` | JSON object | yes | Kind-specific, bounded metadata |

## GazeSampleBatch

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Client-generated idempotency key |
| `session_id` | UUID | yes | Owning session |
| `sequence` | integer | yes | Contiguous zero-based sequence |
| `schema_version` | string | yes | Sample contract version |
| `captured_from` | timestamp | yes | Earliest included timestamp |
| `captured_to` | timestamp | yes | Latest included timestamp |
| `sample_count` | integer | yes | Declared count for verification |
| `received_at` | timestamp | yes | Server receipt time |
| `payload_checksum` | string | yes | Detects conflicting retries |

Database invariants: `(session_id, sequence)` and `(session_id, id)` are unique.
If the same ID is retried with a different checksum, reject it as a conflict.

## GazeSample

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `batch_id` | UUID | yes | Owning batch |
| `offset` | integer | yes | Stable order inside batch |
| `timestamp` | timestamp | yes | Client-observed time |
| `x_normalized` | decimal | yes | Horizontal viewport position |
| `y_normalized` | decimal | yes | Vertical viewport position |
| `confidence` | decimal | no | Model-provided value with documented meaning |
| `scroll_x` | decimal | yes | Horizontal scroll in CSS pixels |
| `scroll_y` | decimal | yes | Vertical scroll in CSS pixels |
| `viewport_width` | integer | yes | Width used for normalization |
| `viewport_height` | integer | yes | Height used for normalization |

## AnalysisJob

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Job identity |
| `session_id` | UUID | yes | Input session |
| `algorithm_version` | string | yes | Reproducible analysis release |
| `status` | enum | yes | `queued`, `running`, `succeeded`, or `failed` |
| `attempt` | integer | yes | Retry attempt |
| `parameters` | JSON object | yes | Complete algorithm configuration |
| `queued_at` | timestamp | yes | Enqueue time |
| `started_at` | timestamp | no | Worker start |
| `finished_at` | timestamp | no | Terminal time |
| `error_code` | string | no | Safe, categorized failure code |

## AnalysisResult

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Immutable result identity |
| `job_id` | UUID | yes | Producing job |
| `session_id` | UUID | yes | Analyzed session |
| `quality` | JSON object | yes | Continuity and calibration summaries |
| `task_metrics` | JSON object | yes | Metrics grouped by task run |
| `fixations` | JSON/child rows | yes | Position, start, duration, and sample count |
| `aoi_metrics` | JSON/child rows | yes | Dwell, TTFF, visits, and revisits |
| `diagnostics` | JSON object | yes | Exclusions, gaps, and warnings |
| `created_at` | timestamp | yes | Result creation time |

## AuditEvent

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | UUID | yes | Event identity |
| `actor_id` | UUID | no | Researcher or system actor |
| `action` | string | yes | Publish, revoke, export, close, delete, or retention action |
| `resource_type` | string | yes | Domain resource category |
| `resource_id` | UUID | yes | Affected resource |
| `occurred_at` | timestamp | yes | Server time |
| `metadata` | JSON object | yes | Bounded, non-sensitive context |

Audit logs must not contain raw tokens, gaze samples, consent content, URLs with
query secrets, or exported participant data.
