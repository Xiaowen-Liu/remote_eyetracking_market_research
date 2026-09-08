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
- A researcher-owned worker seam, `POST /analysis-jobs/{job_id}/run`, performs
  the deterministic task-metrics computation and records one immutable result.
- Result retrieval is separate from job retrieval, so a dashboard can render a
  truthful pending state rather than inventing metrics.
- The first algorithm version reports sample count, mean confidence, centroid,
  sequence boundaries, calibration context, and aggregate eligibility. It does
  not claim fixation, AOI, or heatmap analysis before those algorithms exist.

## Consequences

The HTTP worker seam makes the workflow testable without a private queue or
cloud worker. A production deployment can invoke the same `run_analysis_job`
domain function from a queue consumer; wiring an external queue is deliberately
deferred until deployment requirements justify it.
