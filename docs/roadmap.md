# Delivery roadmap

This roadmap distinguishes implemented portfolio behavior from the controls a
production research service would still require. A checked item is backed by
code and automated tests in this repository; it is not a claim that webcam
gaze estimation has laboratory-grade accuracy.

## Complete

- [x] Full-stack project, study draft, immutable publish, and capability-link flow
- [x] Server-owned consent, calibration, task-run, ingestion, submission, and analysis state machines
- [x] Sequence-aware and idempotent gaze-batch ingestion with an offline browser queue
- [x] Clean-room MV3 extension that runs on arbitrary participant pages
- [x] On-device camera check, nine-point calibration, guided boundary calibration, and center accuracy measurement
- [x] Real task coordinate collection, optional visible-tab snapshots, local artifact export, and API submission
- [x] Researcher replay with viewport/document coordinates, scroll segments, heatmap cuts, scanpath/AOI order, and video export
- [x] AOI aggregation and drill-down across visible sessions, plus recorded DOM proposals
- [x] IndexedDB session archive with rename, hide/unhide, download, and confirmed deletion
- [x] Multi-file JSON/ZIP import, raw-session export, analysis-bundle export, and transparent session-health grading
- [x] Headless Chromium journeys for extension consent/overlay arming and researcher artifact replay
- [x] Vercel web deployment, Railway API/PostgreSQL deployment, OpenAPI contract generation, and CI migration checks

## Next engineering milestones

1. **Camera journey hardening** — expand the current browser automation across
   calibration transitions, task recording, and export; keep real hardware,
   permission prompts, and accuracy as a documented manual smoke test.
2. **Researcher identity and authorization** — replace the temporary demo-owner
   seam with real authentication, per-project roles, and auditable access.
3. **Retention enforcement** — turn each study's retention policy into a tested
   deletion workflow for server telemetry, snapshots, exports, and audit-safe
   tombstones.
4. **Operational hardening** — queue-backed analysis workers, rate limits,
   structured observability, retry/dead-letter handling, and production alerts.
5. **Accessibility and performance pass** — keyboard-complete replay controls,
   reduced-motion behavior, screen-reader status announcements, large-session
   virtualization, and measurable performance budgets.

## Deliberate boundaries

- Camera frames and face landmarks stay in the participant's browser.
- Optional page snapshots are separate from webcam frames and require an
  explicit collection choice.
- Session-health labels summarize collection conditions; they do not certify
  biometric validity or research accuracy.
- Human-subject research, consequential decisions, or external participant
  recruitment require independent privacy, security, consent, and ethics review.
