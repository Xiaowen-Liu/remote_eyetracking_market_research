# ADR 0005: Versioned analysis jobs and immutable task metrics

## Context

Participant collection must complete independently from analysis. A successful
participant submission should create a durable job, retain the exact algorithm
version and parameters, and never replace an existing result in place.

## Decision

- `POST /participant-sessions/{session_id}/submit` validates that all tasks
  have ended and that gaze-batch sequence numbers have no gaps.
- Submission is idempotent and creates one `queued` `AnalysisJob` for the
  current algorithm version and attempt.
- A database-backed worker claims eligible jobs with a row lock, records a bounded
  lease, and performs deterministic task-metrics computation. Expired leases can be
  reclaimed after worker interruption.
- Failures retry with capped exponential delay. After three worker attempts the job
  remains failed with a `dead_lettered_at` timestamp for operator review. The
  researcher-owned `POST /analysis-jobs/{job_id}/run` seam remains available for
  deterministic debugging.
- Result retrieval is separate from job retrieval, so a dashboard can render a
  truthful pending state rather than inventing metrics.
- The first algorithm version reports sample count, mean confidence, centroid,
  sequence boundaries, calibration context, and aggregate eligibility. It does
  not claim fixation, AOI, or heatmap analysis before those algorithms exist.

## Consequences

The queue remains inside PostgreSQL, avoiding a second broker while preserving
durability, concurrency-safe claims, retry timing, and dead-letter evidence. A
dedicated worker process can scale independently from the API. Very high-volume
deployments may replace this adapter with a managed queue without changing the
analysis domain function or immutable result contract.
