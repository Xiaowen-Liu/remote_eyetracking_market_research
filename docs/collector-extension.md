# Clean-room browser collector

`collector-extension/` is the M12 browser-context foundation. It is separate
from the Vercel web application because only an installed extension can observe
an arbitrary participant tab and request an optional visible-tab snapshot.

It records page-open, navigation, settled-scroll, and DOM-change events in
extension session storage. Visible-tab snapshots require the researcher to turn
on the policy before starting the collection session. Raw camera video is never
stored in the artifact.

This first slice deliberately does not claim gaze inference inside arbitrary
pages. The current bridge adds on-device MediaPipe landmarks, an explicit
in-page camera control, a nine-point calibration fit, a gaze cursor, and a
local heat trail. It remains experimental and calibration-dependent.

## Load locally

1. Run `npm run build:collector`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load
   unpacked**.
3. Select `collector-extension/` (not `collector-extension/dist/`).
4. Open a target page, use the collector popup to start a session, then click
   **Enable camera locally** in the page overlay.

The extension bundle is packaged locally. On first camera use it fetches the
MediaPipe WASM/model assets; those are model/runtime data, not webcam data.

## Replay coordinate contract

Each calibrated gaze sample uses normalized visible-viewport coordinates and
records the page URL, viewport size, scroll offset, and timestamp observed at
capture time. Opt-in snapshots preserve the same viewport and scroll context.

The local Results viewer groups samples by matching URL and the time interval
between adjacent snapshots, then aggregates them into bounded heatmap cells.
This keeps replay rendering proportional across display sizes and avoids
placing samples from another navigation onto the selected screenshot. Older
artifacts without capture context remain readable; when there is only one
snapshot, their session-level samples are shown as a compatibility fallback.

The heatmap is an exploratory visualization of estimated browser coordinates.
It is not a fixation classifier or a validated measure of visual attention.
