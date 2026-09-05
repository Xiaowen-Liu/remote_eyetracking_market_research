# Privacy model

WebGaze is an independent, open-source portfolio project. It is not affiliated
with an employer, research participant, or commercial eye-tracking product.

## Data handling

- Webcam frames are processed locally by WebGazer.js and are not recorded or
  uploaded by this extension.
- Gaze coordinates, participant-provided identifiers, page URLs, areas of
  interest, and captured page screenshots are stored in Chrome local storage.
- Export happens only when the user explicitly downloads a session JSON file.
- The project has no analytics service, remote API, or cloud backend.

Screenshots and URLs can still contain sensitive information. Researchers are
responsible for obtaining informed consent, choosing appropriate test pages,
protecting exported files, and deleting data when it is no longer needed.

## Safe demonstrations

Public demos, screenshots, fixtures, and repository examples must use synthetic
participants and non-sensitive websites. Do not commit real participant data,
camera recordings, private URLs, credentials, or employer-owned research data.

## Not for consequential decisions

Webcam-based gaze estimation is affected by lighting, camera placement,
calibration quality, movement, glasses, and browser performance. Results are
appropriate for exploratory UX research, not medical diagnosis, accessibility
certification, employee monitoring, identity verification, or other high-impact
decisions.
