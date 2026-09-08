# ADR 0004: Make participant collection an explicit server state machine

Status: accepted

## Context

Calibration, task boundaries, and gaze uploads determine whether research data
can be interpreted later. Treating them as client-only UI state would allow weak
calibrations, overlapping tasks, duplicate samples, or samples collected before
consent to appear valid.

## Decision

The versioned participant API owns three related transitions:

1. A consented session records ordered calibration attempts. The published
   calibration policy determines whether a result advances the session to
   `ready`; failed or below-threshold results remain `calibrating`.
2. Tasks start in their immutable published order. The database and API allow
   only one running task per session, and completion records an explicit
   `completed`, `skipped`, or `timed_out` event.
3. Gaze samples are accepted only while a session is collecting. A client UUID
   and sequence identify each bounded batch, while a server-derived SHA-256
   checksum distinguishes a safe replay from conflicting content. Out-of-order
   batches remain valid and the response exposes missing sequences.

Participant bearer tokens authorize all three operations. Raw samples and token
values are never written to events or logs.

## Consequences

- Network retry is safe without duplicating samples.
- Task segmentation comes from durable events rather than timestamp inference.
- Calibration quality remains separate from later attention metrics.
- The client must retain its batch UUID and sequence until acknowledgement.
- Session submission must reject unresolved sequence gaps in a later milestone.
