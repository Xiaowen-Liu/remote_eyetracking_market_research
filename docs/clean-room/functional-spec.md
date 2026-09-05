# Clean-room functional specification

Status: baseline for independent implementation
Date: 2026-09-04

## Purpose

WebGaze is a portfolio-grade, full-stack eye-tracking research platform. It
demonstrates browser instrumentation, REST API design, durable data ingestion,
asynchronous analysis, data visualization, privacy controls, and production
engineering.

This specification describes externally observable product behavior. It does
not authorize copying code, data, styling, internal documentation, or product
assets from any prior implementation.

## Product boundary

The product lets a researcher:

1. Create a research project.
2. Configure an eye-tracking study with one to four task prompts.
3. Validate and publish an immutable study version.
4. Share a revocable participant link.
5. Collect consent, calibration results, task events, and gaze samples.
6. Process the completed session asynchronously.
7. Review quality, heatmaps, fixations, scanpaths, and AOI metrics by task.
8. Compare multiple anonymous sessions and export results.
9. Close a study and delete participant data.

The public portfolio version does not include participant recruitment,
questionnaire branching, rich-text study authoring, audio responses, general
screen-recording management, or an enterprise hosting integration.

## Primary users

### Researcher

Creates, publishes, monitors, analyzes, exports, and closes studies.

### Participant

Uses a time-limited link, reviews consent, calibrates gaze tracking, completes
the study tasks, and can leave or withdraw before submission.

## Researcher workflow

### Projects dashboard

The researcher can create, rename, archive, and open a project. Each project
shows its studies, lifecycle state, published version, completed-session count,
and latest activity. Empty, loading, failure, and unauthorized states must be
explicit.

### Study draft

A draft contains:

- title and research question;
- target origin or URL allowlist;
- consent copy and version;
- one to four ordered tasks;
- optional areas of interest (AOIs);
- calibration and collection settings;
- retention period and optional participant limit.

Each task contains a short title, plain-text prompt, start URL, optional success
URL rule, optional time limit, and zero or more AOIs. A task prompt provides the
experimental context for segmenting gaze data; it is not a general survey
question.

### Validation and publish

Publishing must be a server-side state transition, not a client-only flag.
Before publishing, the server validates all required fields and returns
field-addressable issues. A successful publish:

- creates an immutable study-version snapshot;
- assigns a monotonically increasing version number;
- creates or activates a high-entropy participant link;
- records an audit event;
- is safe to retry through an idempotency key.

An existing published version never changes. Further edits create a new draft,
which can later be published as a new version. Sessions remain bound to the
version they started with.

### Published study controls

The researcher can preview the participant experience, copy the link, set its
expiration or participant limit, revoke it, create a replacement link, close
the study, or create a revision. Closing prevents new sessions but does not
silently invalidate already-started sessions.

## Participant workflow

### Link resolution

Opening a participant link resolves a public protocol containing only the
information needed to run the study. Internal researcher data and raw database
identifiers are never returned. Invalid, expired, revoked, closed, and
capacity-reached links have distinct responses.

### Consent and environment check

Before camera access, the participant sees:

- what data is collected;
- what is not collected;
- the study's retention period;
- how to withdraw before submission;
- browser, camera, lighting, and positioning requirements.

Consent records the exact consent version and timestamp. Webcam frames are
processed on-device and are not persisted or uploaded.

### Calibration

The collection client guides the participant through camera readiness,
multi-point calibration, an accuracy check against known targets, and a retry
or exit path. Calibration output includes observations and a quality summary;
it must not be presented as laboratory-grade accuracy.

### Task execution

Tasks run in published order. Starting and ending a task produces explicit
events so samples can be segmented without inference. The participant can
complete, skip, or time out a task. A page change, scroll, viewport resize,
pause, reconnect, or tracking-quality warning is recorded as a session event.

### Sample ingestion

The collection client buffers gaze samples locally and uploads bounded batches
through a versioned REST API. Each batch includes a unique ID and sequence
number. The server validates ownership, session state, payload size, timestamps,
coordinates, and schema version. Repeating the same batch is idempotent.

Temporary network loss must not immediately end a study. Buffered batches retry
with backoff, and the participant receives an honest connection state. The
server can report missing sequences before completion.

### Completion and withdrawal

Completing a session freezes collection, checks batch continuity, records final
task outcomes, and enqueues analysis. Submission returns immediately with an
analysis-job reference. Withdrawal deletes or invalidates unsubmitted data
according to the documented privacy policy.

## Analysis workflow

Analysis runs outside the request process and produces immutable,
algorithm-versioned results. The pipeline:

1. validates sequence and timestamp continuity;
2. normalizes coordinates using viewport and scroll context;
3. removes or flags invalid samples;
4. calculates tracking-health windows;
5. segments samples by task;
6. detects fixations using a documented method;
7. maps fixations to applicable AOIs;
8. calculates dwell, time-to-first-fixation, visits, and revisits;
9. generates scanpath and heatmap-ready aggregates;
10. saves diagnostics, parameters, and output together.

Signal continuity, calibration error, and inferred attention metrics are
reported separately. A low-quality session remains inspectable but is excluded
from aggregate claims by default.

## Results dashboard

The dashboard supports:

- analysis status and failure recovery;
- calibration and tracking-health inspection;
- task-scoped heatmap and raw-point overlays;
- fixation sequence and scanpath;
- AOI dwell, time-to-first-fixation, visits, and revisits;
- participant-level evidence behind aggregates;
- comparison across task and session;
- JSON and CSV export;
- participant-session deletion.

Every visual metric must expose its definition, unit, quality context, and
underlying session count. Keyboard navigation and non-visual alternatives are
required for core analysis controls.

## Lifecycle states

### Study

`draft -> published -> closed -> archived`

A published study can create a separate draft revision. Illegal transitions
return a conflict response and do not partially update state.

### Participant session

`created -> consented -> calibrating -> ready -> running -> submitted`

`calibrating` and `running` may enter and leave `paused`. A pre-submission
session can become `withdrawn`, `expired`, or `abandoned`. Terminal states are
immutable except for administrative deletion.

### Analysis job

`queued -> running -> succeeded | failed`

A failed job can be retried as a new attempt without overwriting the previous
diagnostics.

## Non-functional requirements

- All APIs are versioned and documented through OpenAPI.
- Mutating operations enforce authorization and resource ownership.
- Publish, batch ingestion, completion, and deletion are transaction-safe.
- Raw participant identifiers are unnecessary; aliases are preferred.
- Logs use correlation IDs and exclude gaze payloads and participant content.
- Database migrations are reproducible from an empty database.
- Critical workflows have unit, integration, and end-to-end tests.
- Synthetic fixtures support demos without a camera or participant data.
- The project runs locally through one documented command and has a deployed
  portfolio environment.

## Acceptance journey

A reviewer can clone the repository, start the stack, sign in as the seeded
researcher, publish a four-task study, run or replay a synthetic participant
session, observe asynchronous processing, inspect task-level attention metrics,
export the result, and run the automated test suite without private services or
data.
