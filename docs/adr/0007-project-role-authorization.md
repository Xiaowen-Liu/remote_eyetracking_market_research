# ADR 0007: Project role authorization

## Status

Accepted

## Context

Researcher authentication proves identity but does not by itself decide which
studies or participant results that identity may access. Comparing every request
only with a project's original owner prevents collaboration, while scattered
route-specific checks are difficult to audit and easy to bypass accidentally.

## Decision

- Projects use three ordered roles: Owner, Editor, and Viewer.
- The original project owner remains an implicit Owner so projects created before
  this migration stay accessible. New authenticated projects also receive an
  explicit Owner membership.
- Viewer may read project configuration, study versions, participant summaries,
  analysis results, and exports.
- Editor adds project and study mutations, publishing, synthetic demo creation,
  and analysis execution.
- Owner adds project deletion, membership administration, and audit-log access.
- A caller with no membership receives the same 404 as a missing resource. A known
  member whose role is insufficient receives a stable 403 response.
- Central authorization helpers resolve project, study, and analysis-job access;
  participant capability-token routes remain independent.
- Project creation, updates, publishing, analysis exports, and membership changes
  emit project-scoped audit events. Owners can retrieve the latest 200 events.
- Audit project IDs are intentionally durable references rather than cascading
  foreign keys, so deleting a project does not erase its audit history.
- Ownership transfer is atomic: the selected collaborator becomes Owner, the
  previous Owner remains as an explicitly selected Editor or Viewer, and one audit
  event records the transition. Self-service invitation acceptance remains outside
  this slice; collaborators must already have a researcher account.
- A viewer-readable capability endpoint lets the web application render the
  effective role without duplicating authorization rules. The Team & access UI
  exposes membership mutations and the audit feed only when that endpoint grants
  owner capabilities.

## Consequences

Backend access is enforced consistently across nested resources, and tests exercise
real login sessions rather than spoofed owner headers. The generated contract keeps
the member-management UI aligned with the same server-owned authorization boundary.
Audit events are operational evidence, not an immutable compliance ledger; stronger
tamper resistance and long-term audit retention remain future production work.
