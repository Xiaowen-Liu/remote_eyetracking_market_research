# Failure modes and recovery requirements

Status: implementation checklist
Date: 2026-09-04

The system must fail visibly, preserve explainability, and avoid inventing
successful research data. The cases below become acceptance tests as each
milestone is implemented.

## Publish and protocol integrity

| Failure | Required behavior | Verification |
|---|---|---|
| Required draft field missing | Return structured validation issues; create no version or link | API integration test |
| User double-clicks Publish | Idempotency key returns the same result | Concurrent integration test |
| Two editors publish concurrently | One transaction succeeds; the stale revision receives a conflict | Database concurrency test |
| Published task is later edited | Existing version and bound sessions remain unchanged | Versioning test |
| Link expires, is revoked, or reaches capacity | Reject only new sessions with distinct safe error codes | API test per state |
| Study closes during an active session | Block new sessions; apply a documented policy to the active session | End-to-end test |

## Camera and calibration

| Failure | Required behavior | Verification |
|---|---|---|
| Camera permission denied | Explain how to retry; do not create a successful calibration | Browser test/manual check |
| No camera or incompatible browser | Stop before collection and preserve a non-sensitive diagnostic | Browser capability test |
| Face is absent, poorly lit, or unstable | Show readiness feedback without making demographic inferences | Synthetic/manual scenario |
| Model initialization is slow | Show bounded progress and a timeout with retry | Injected-delay test |
| Accuracy check is weak | Allow recalibration or exit; record failed/limited quality separately | Deterministic fixture |
| Viewport changes after calibration | Warn, pause, or require recalibration according to policy | Resize test |

## Extension and browser lifecycle

| Failure | Required behavior | Verification |
|---|---|---|
| MV3 service worker restarts | Restore non-sensitive session state and continue safely | Worker-restart test |
| Content script is unavailable | Retry injection where permitted or show an actionable error | Restricted-page test |
| Participant navigates to a restricted browser page | Pause collection and explain limitation | Manual browser test |
| Tab closes or changes origin unexpectedly | Persist buffered data and mark session interrupted | Browser end-to-end test |
| Page scrolls or resizes | Record context so coordinates remain interpretable | Coordinate fixture |
| SPA mutates without navigation | Capture bounded page-context events without excessive observation | DOM mutation test |
| Browser storage quota is approached | Flush batches earlier and surface risk before loss | Quota simulation |

## Sample ingestion

| Failure | Required behavior | Verification |
|---|---|---|
| Temporary network loss | Buffer locally and retry with capped exponential backoff | Offline browser test |
| Same batch is retried | Return prior success without duplicating samples | Idempotency test |
| Same batch ID has different content | Reject as conflict and log metadata only | Checksum test |
| Batch arrives out of order | Store safely and report missing sequences | Integration test |
| Batch is too large | Reject before persistence with documented limit | Boundary test |
| Timestamp is malformed or implausible | Reject or quarantine sample with diagnostic count | Property-based validation test |
| Coordinates are NaN or out of range | Reject invalid samples; never coerce them into valid attention | Unit test |
| Session is already submitted | Reject further batches | State-machine test |
| Client retries completion | Return the same submission/job reference | Idempotency test |

## Analysis pipeline

| Failure | Required behavior | Verification |
|---|---|---|
| One or more sequences are missing | Mark analysis incomplete or quality-limited; do not hide the gap | Missing-batch fixture |
| Long gaps occur between samples | Report continuity windows and exclude gaps from dwell | Synthetic timeline test |
| Samples are unsorted | Sort deterministically or reject according to contract | Unit test |
| Clock jumps backward | Flag affected interval and avoid negative durations | Synthetic clock fixture |
| Worker crashes mid-analysis | Retry as a new attempt without partial published results | Worker integration test |
| Algorithm changes | Produce a new immutable result with version and parameters | Re-analysis test |
| No AOIs apply to a task | Preserve fixation output and show an explicit empty AOI result | Analytics unit test |
| Selector-based AOI moves | Resolve per page state and retain the resolved rectangle as evidence | DOM/coordinate fixture |
| Session quality is low | Keep session inspectable; exclude from aggregate by default | Rollup test |
| Analysis exceeds resource limit | Fail with categorized diagnostics; do not block API workers | Load/timeout test |

## Dashboard and interpretation

| Failure | Required behavior | Verification |
|---|---|---|
| Analysis is queued or running | Display current state without fake metrics | Component test |
| Analysis fails | Show safe reason and retry action when allowed | Component/end-to-end test |
| Imported export uses unsupported schema | Reject with actionable compatibility message | Unit test |
| Screenshot or page context is unavailable | Show gaze metrics without a misleading background image | Visual regression test |
| Aggregate contains one usable session | Show sample size prominently; avoid comparative claims | Component test |
| Keyboard or screen reader user opens analysis | Core controls and metric alternatives remain available | Playwright + axe + manual test |
| Export is very large | Stream or background the export; avoid browser lockup | Performance test |

## Privacy, authorization, and deletion

| Failure | Required behavior | Verification |
|---|---|---|
| Researcher requests another owner's project | Return not-found or forbidden without leaking metadata | Authorization test |
| Public token is guessed or logged | Use high entropy, store a hash, redact logs and query strings | Security review/test |
| Consent was not recorded | Prevent collection and submission | State-machine test |
| Screenshot setting is off | Never capture or upload screenshots | Browser integration test |
| Participant withdraws before submission | Stop collection and delete or invalidate buffered/server data | End-to-end deletion test |
| Researcher deletes a session | Remove raw samples, results, exports, and objects consistently | Cascade/deletion test |
| Retention deadline passes | Background job deletes all covered participant artifacts | Time-controlled job test |
| Deletion partially fails | Record recoverable job state and retry; never report full success | Fault-injection test |
| Logs or traces receive raw payloads | Redaction prevents storage of samples, tokens, or consent content | Logging test |

## Deployment and operations

| Failure | Required behavior | Verification |
|---|---|---|
| Database migration fails | Deployment stops before serving mixed schema versions | Deployment test |
| Database is temporarily unavailable | API returns a controlled failure; workers retry bounded operations | Fault-injection test |
| Queue is unavailable | Session submission remains idempotent and analysis can be enqueued later | Integration test |
| Application restarts during upload | Persisted batch state survives; client can resume | Restart test |
| Health check passes while dependencies fail | Readiness reports dependency failure separately from liveness | Operations test |
| Traffic exceeds limit | Rate limiting protects public and ingestion endpoints | Load test |

## Demo resilience

The portfolio demonstration must not depend on live webcam conditions. It needs
both a live collection path and a deterministic synthetic-session path. The
synthetic path must exercise publish, participant task segmentation, ingestion,
asynchronous analysis, dashboard inspection, and export with no private service
or real participant data.
