# Clean-room browser collector

`collector-extension/` is the M12 browser-context foundation. It is separate
from the Vercel web application because only an installed extension can observe
an arbitrary participant tab and request an optional visible-tab snapshot.

It records page-open, navigation, settled-scroll, and DOM-change events in
extension session storage. Visible-tab snapshots require the researcher to turn
on the policy before starting the collection session. Raw camera video is never
stored in the artifact.

This first slice deliberately does not claim gaze inference inside arbitrary
pages. The next slice will add a reviewed bridge between the on-device gaze
estimator and this collector, plus an overlay/replay format.
