# Experimental on-device eye tracking

Route: `/experimental/eye-tracking` (run locally during development).

## Scope

This route is separate from the deployed participant-research workflow. It
uses a webcam only after an explicit browser permission prompt, runs MediaPipe
Face Landmarker in the browser, derives a pair of normalized iris features, and
fits a small affine screen-space mapping from nine calibration points.

The generated gaze coordinates and calibration error stay in memory in the
current browser tab. The only persistence action is an explicit JSON download.
No video frames, facial landmarks, or gaze coordinates are posted to the
WebGaze API.

## Development

1. Run `npm run dev:web`.
2. Open `http://localhost:5173/experimental/eye-tracking` on HTTPS or
   localhost in a supported browser.
3. Allow camera access, wait for the face-landmark status, then complete each
   calibration point while looking at its marker.
4. Observe the predicted cursor and download the local JSON fixture if needed.

## Implementation

- `@mediapipe/tasks-vision@1.0.1` provides the on-device Face Landmarker.
- `gazeMath.ts` independently implements the feature-to-screen affine fit,
  numerical solve, prediction clamp, and calibration RMS calculation.
- The model's remote WASM/model assets are fetched on first use; the browser's
  captured image frames are not uploaded by this application.

MediaPipe is used under Apache-2.0. See its [upstream repository](https://github.com/google-ai-edge/mediapipe)
for model and runtime documentation.

## Limitations

This is an experimental, calibration-dependent estimate. It is not validated
for accessibility certification, medical, employment, safety, identity, or any
other consequential decision. Lighting, glasses, head motion, camera placement,
and calibration behavior materially affect output quality.
