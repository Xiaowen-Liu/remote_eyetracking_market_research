# Clean-room browser collector

`collector-extension/` is the M12 browser-context foundation. It is separate
from the Vercel web application because only an installed extension can observe
an arbitrary participant tab and request an optional visible-tab snapshot.

It records page-open, navigation, settled-scroll, and DOM-change events in
extension session storage. Visible-tab snapshots require the researcher to turn
on the policy before starting the collection session. Raw camera video is never
stored in the artifact.

The extension is an experimental participant client for a published study. It
uses on-device MediaPipe landmarks, an explicit in-page camera control, and a
nine-point calibration fit to produce coordinate estimates. It remains
calibration-dependent and is not a validated attention measurement.

## Load locally

1. Run `npm run build:collector`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load
   unpacked**.
3. Select `collector-extension/` (not `collector-extension/dist/`).
4. In the researcher app, publish a study that has **experimental webcam gaze**
   enabled, then copy its participant link.
5. Open the target page for the study, open the extension popup, paste that
   participant link, and explicitly accept the displayed consent text.
6. The extension creates the anonymous participant session, opens the first
   task URL, and shows the in-page camera control. Start the camera, grant
   browser permission, pass the local camera check, then complete the
   three-step calibration: three captures at each nine-point target; a closed
   boundary trace with two captures per corner, speed/rail validation,
   120 ms passive samples, and one mid-edge anchor; then a five-second
   center-gaze accuracy check. Camera video and face-position guidance appear
   only during camera check; calibration and study tasks keep the local camera
   runtime active without displaying either element.
7. When the server accepts calibration quality, return to the popup, start each
   task, and complete it from the popup. Finish by submitting the session.

The extension bundle is packaged locally. On first camera use it fetches the
MediaPipe WASM/model assets; those are model/runtime data, not webcam data.
Camera frames and landmarks stay in the active browser tab. During a running,
consented task, the API receives only estimated normalized coordinates plus
timestamp, scroll, and viewport context. The participant access token is held
in extension session storage and is not written to the exported artifact.

## Server-backed lifecycle

The extension uses the same server-owned participant lifecycle as the web
client: capability link resolution → consent → calibration acceptance → ordered
task runs → idempotent, sequence-numbered gaze batches → submit. Completing a
task drains the final local samples before the task-run completion request. If
the network fails before a batch acknowledgement, the pending batch remains in
session storage with its client batch id and sequence for safe retry.

## Replay coordinate contract

Each calibrated gaze sample uses normalized visible-viewport coordinates and
records the page URL, viewport size, scroll offset, and timestamp observed at
capture time. The overlay may render at display refresh rate, while artifact
sampling is bounded to approximately 10 Hz. Opt-in snapshots preserve the same
viewport and scroll context. Background storage mutations are serialized so
dense event and gaze batches cannot overwrite one another during asynchronous
read-modify-write operations.

The local Results viewer groups samples by matching URL and the time interval
between adjacent snapshots, then aggregates them into bounded heatmap cells.
This keeps replay rendering proportional across display sizes and avoids
placing samples from another navigation onto the selected screenshot. Older
artifacts without capture context remain readable; when there is only one
snapshot, their session-level samples are shown as a compatibility fallback.

The heatmap is an exploratory visualization of estimated browser coordinates.
It is not a fixation classifier or a validated measure of visual attention.
