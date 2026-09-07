# ADR 0002: Mutable draft and immutable published study versions

Status: accepted

## Context

Researchers need to edit a protocol repeatedly, while participant sessions must
remain bound to exactly the tasks and consent language they received. A publish
retry must not create duplicate versions or links.

## Decision

Each study owns one mutable `StudyVersion` with `version_number = 0`. Published
snapshots use monotonically increasing positive version numbers and are never
updated. A publish transaction locks the study row, clones the draft and its
tasks/AOIs, creates a hashed high-entropy participant link, and records an audit
event containing the draft revision and a hash of the idempotency key.

Replaying an idempotency key returns its original version. Publishing an
unchanged draft with another key returns the existing version. Participant link
resolution returns a minimal public protocol without owner or database IDs.

## Consequences

- Existing sessions remain reproducible after a researcher edits the draft.
- Task replacement is transactional and task positions remain contiguous.
- Raw participant tokens are returned only when created; only their SHA-256
  hashes are stored.
- The version-zero convention must remain explicit in migrations and service
  code until a dedicated draft table becomes worthwhile.
