# Five-minute demo runbook

## Goal

Demonstrate the complete researcher-to-result flow while being explicit that the public participant data is synthetic.

## Script

1. Open the live app and show the Projects workspace. Create a project, optionally recording a research question.
2. Create or open a study. Point out consent version, target origin, retention period, and ordered tasks. Publish it to create an immutable version.
3. Copy the participant link and open it in a separate browser context. Explain that it is a high-entropy capability link rather than a participant login.
4. Run the participant flow: consent, calibration, task start, synthetic sample upload, task completion, and analysis submission. Toggle the offline demo to show that uploads buffer locally and retry in sequence.
5. Return to Results. Show collection-health metadata, task metrics, session selection, synthetic provenance, and JSON/CSV export.
6. Open API docs and highlight the generated contract plus the independent test suite that locks the collection journey.

## Talking points

- Published versions are immutable, so protocol edits do not rewrite a participant's historical session.
- The API owns lifecycle validation; the UI cannot skip consent or fabricate a completed session.
- Gaze-batch ingestion is idempotent and sequence-aware for intermittent networks.
- Synthetic results are intentionally marked aggregate-ineligible so the demo cannot be mistaken for real research data.
