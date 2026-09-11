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

## Optional browser-collector demo

Use this only locally with a self-controlled target page and a Chrome profile
where the collector has been loaded from source. This is a separate
browser-context capability, not a feature the Vercel page can emulate.

1. Run `npm run build:collector`, load `collector-extension/` as an unpacked
   extension, and open a test page you control.
2. Start a collection session from the extension popup. Explain that page
   events are kept in extension session storage and snapshots are opt-in.
3. Click **Enable camera locally** in the in-page overlay. Grant camera access
   only for this self-test, then record each of the nine visible calibration
   targets. Show the calibrated cursor and local heat trail.
4. Stop the collection session and download its JSON artifact. Point out that
   it contains estimated coordinates, page events, and only any explicitly
   enabled visible-tab snapshots—never raw webcam video.
5. Return to **Research results**, open the exported JSON with **Open collector
   JSON**, and show the local timeline and snapshot review. Explain that this
   view does not upload the artifact to the API.

## Talking points

- Published versions are immutable, so protocol edits do not rewrite a participant's historical session.
- The API owns lifecycle validation; the UI cannot skip consent or fabricate a completed session.
- Gaze-batch ingestion is idempotent and sequence-aware for intermittent networks.
- Synthetic results are intentionally marked aggregate-ineligible so the demo cannot be mistaken for real research data.
- The browser collector uses a clean-room, calibration-dependent estimate; it is
  exploratory software, not a validated or consequential measurement system.
