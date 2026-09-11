# Architecture overview

## System boundaries

WebGaze Research has three intentionally separate execution surfaces:

1. **Researcher web app** — React/Vite UI for projects, protocol drafts, publishing, results, comparison, and export.
2. **Participant web route** — a token-scoped protocol runner. The public demo creates synthetic samples only, but exercises the same consent, calibration, task, batch, submission, and analysis APIs.
3. **API and database** — FastAPI, SQLAlchemy, Alembic, and PostgreSQL own the domain state and enforce transitions. The browser cannot decide that a session is valid by itself.

## Core invariants

- A published study version is never changed in place.
- Participant access tokens are returned once and stored only as SHA-256 hashes.
- Consent records the exact version shown to the participant.
- Calibration attempts are ordered and must meet the published quality threshold before task collection can begin.
- Task runs are ordered and non-overlapping.
- Every gaze batch is identified by both client ID and sequence number; replays with identical checksum are safe, while divergent content is rejected.
- A submitted session produces one analysis job per algorithm version/attempt.
- Analysis outputs are immutable. Synthetic results carry explicit provenance and are excluded from aggregate claims.

## Reliability seams

The public web client keeps a local queue of unsent batches. On reconnect it retries in sequence and removes each batch only after acknowledgement. The API then provides the final authority for gaps, duplicates, and state transitions.

The analysis runner is currently exposed as an HTTP worker seam, making its domain function easy to test. A production queue consumer can call the same domain function without changing the resource contract.

## What is deliberately not claimed

The public participant demo is not a camera-based eye-tracking product. It does not upload frames, identify people, or claim accuracy. This lets the portfolio show data-lifecycle engineering without representing synthetic data as research evidence.
