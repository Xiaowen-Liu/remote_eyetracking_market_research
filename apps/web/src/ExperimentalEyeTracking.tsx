import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample, type GazeFeature, type GazeModel } from "./gazeMath";

const points: ReadonlyArray<readonly [number, number]> = [
  [0.12, 0.14], [0.5, 0.14], [0.88, 0.14], [0.12, 0.5], [0.5, 0.5], [0.88, 0.5], [0.12, 0.86], [0.5, 0.86], [0.88, 0.86],
];

type State = "intro" | "camera" | "calibrating" | "tracking" | "error";
type LocalSample = { at: string; x: number; y: number; confidence: number };

function midpoint(a: NormalizedLandmark, b: NormalizedLandmark): GazeFeature {
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}

function featureFromLandmarks(landmarks: NormalizedLandmark[]): GazeFeature | null {
  // Iris centers, normalized inside each eye corner pair. Both eyes reduce head-translation noise.
  const leftIris = landmarks[468]; const rightIris = landmarks[473];
  const leftOuter = landmarks[33]; const leftInner = landmarks[133];
  const rightOuter = landmarks[263]; const rightInner = landmarks[362];
  if (![leftIris, rightIris, leftOuter, leftInner, rightOuter, rightInner].every(Boolean)) return null;
  const leftCenter = midpoint(leftOuter, leftInner); const rightCenter = midpoint(rightOuter, rightInner);
  const leftWidth = Math.abs(leftOuter.x - leftInner.x) || 0.001;
  const rightWidth = Math.abs(rightOuter.x - rightInner.x) || 0.001;
  const horizontal = ((leftIris.x - leftCenter[0]) / leftWidth + (rightIris.x - rightCenter[0]) / rightWidth) / 2;
  const vertical = ((leftIris.y - leftCenter[1]) / leftWidth + (rightIris.y - rightCenter[1]) / rightWidth) / 2;
  return [horizontal, vertical];
}

export function ExperimentalEyeTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const frameRef = useRef<number | null>(null);
  const featureRef = useRef<GazeFeature | null>(null);
  const modelRef = useRef<GazeModel | null>(null);
  const samplesRef = useRef<LocalSample[]>([]);
  const [state, setState] = useState<State>("intro");
  const [message, setMessage] = useState("");
  const [calibrationIndex, setCalibrationIndex] = useState(0);
  const [calibrationSamples, setCalibrationSamples] = useState<CalibrationSample[]>([]);
  const [gaze, setGaze] = useState<GazeFeature | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [quality, setQuality] = useState<number | null>(null);
  const [localSampleCount, setLocalSampleCount] = useState(0);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    landmarkerRef.current?.close();
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startCamera() {
    try {
      setState("camera"); setMessage("Loading the on-device landmark model…");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
      landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" },
        runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
      setMessage("Camera is local to this browser. Position your face in the preview, then begin calibration.");
      runFrame();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Camera access could not start.");
    }
  }

  function runFrame() {
    const video = videoRef.current; const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;
    const result = landmarker.detectForVideo(video, performance.now());
    const feature = result.faceLandmarks[0] ? featureFromLandmarks(result.faceLandmarks[0]) : null;
    featureRef.current = feature;
    setFaceDetected(Boolean(feature));
    if (feature && modelRef.current) {
      const next = predictGaze(modelRef.current, feature);
      setGaze(next);
      samplesRef.current.push({ at: new Date().toISOString(), x: next[0], y: next[1], confidence: 1 });
      if (samplesRef.current.length % 12 === 0) setLocalSampleCount(samplesRef.current.length);
    }
    frameRef.current = requestAnimationFrame(runFrame);
  }

  function beginCalibration() { setCalibrationSamples([]); setCalibrationIndex(0); setState("calibrating"); }
  function recordPoint() {
    if (!featureRef.current) { setMessage("Face not detected yet. Keep your eyes visible, then try again."); return; }
    const next = [...calibrationSamples, { feature: featureRef.current, target: points[calibrationIndex] }];
    setCalibrationSamples(next);
    if (calibrationIndex < points.length - 1) { setCalibrationIndex((index) => index + 1); return; }
    const model = fitGazeModel(next);
    if (!model) { setMessage("Calibration could not fit. Try again in steadier lighting."); return; }
    modelRef.current = model;
    setQuality(calibrationError(model, next)); setState("tracking"); setMessage("Live estimate active. Samples remain only in this tab until you download them.");
  }
  function downloadLocalSamples() {
    const blob = new Blob([JSON.stringify({ source: "local-experimental-mediapipe", samples: samplesRef.current, calibration_error: quality }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "webgaze-local-samples.json"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="experimental-shell">
    <header className="experimental-header"><a className="brand" href="/">◉ WebGaze Research</a><span className="environment">Local experimental mode</span></header>
    <main className="experimental-main">
      <p className="eyebrow">Real eye-tracking prototype</p><h1>On-device gaze estimation</h1>
      <p className="experimental-lede">A clean-room experimental client. Camera frames are processed in this browser to derive face and iris landmarks; they are not sent to the WebGaze API.</p>
      <div className="experimental-grid">
        <section className="experimental-card"><h2>{state === "tracking" ? "Live estimate" : "Camera & calibration"}</h2>
          <div className="camera-frame"><video ref={videoRef} muted playsInline /><span className={faceDetected ? "camera-state ready" : "camera-state"}>{faceDetected ? "Face landmarks detected" : "Waiting for face"}</span></div>
          {message && <p className={state === "error" ? "experimental-message error" : "experimental-message"}>{message}</p>}
          {state === "intro" && <button className="primary-button" onClick={startCamera}>Allow camera and start locally</button>}
          {state === "camera" && <button className="primary-button" disabled={!faceDetected} onClick={beginCalibration}>Begin 9-point calibration</button>}
          {state === "tracking" && <button className="secondary-button" onClick={downloadLocalSamples}>Download local sample JSON ({localSampleCount})</button>}
        </section>
        <section className="experimental-card gaze-board" aria-label="Gaze calibration board">
          {state === "calibrating" ? <><p className="eyebrow">Point {calibrationIndex + 1} of 9</p><p>Look at the dot, then click <strong>Record point</strong>. Keep your head still.</p>
            <button className="calibration-target" style={{ left: `${points[calibrationIndex][0] * 100}%`, top: `${points[calibrationIndex][1] * 100}%` }} onClick={recordPoint} aria-label={`Record calibration point ${calibrationIndex + 1}`} />
            <button className="secondary-button calibration-action" onClick={recordPoint}>Record point</button></> : <>
            <p className="eyebrow">Screen-space estimate</p><p>{state === "tracking" ? `Calibration RMS error: ${((quality ?? 0) * 100).toFixed(1)}% of screen diagonal.` : "Calibrate to enable a predicted gaze cursor."}</p>
            {gaze && <span className="gaze-cursor" style={{ left: `${gaze[0] * 100}%`, top: `${gaze[1] * 100}%` }} />}
            {state === "tracking" && <span className="board-status">Local samples: {localSampleCount}</span>}</>}
        </section>
      </div>
      <aside className="experimental-disclosure"><strong>Privacy & limitations.</strong> This is a browser-based estimate, not a biometric identification system or validated measurement device. It requires explicit camera permission; raw frames never leave this page. Avoid making consequential decisions from its output.</aside>
    </main>
  </div>;
}
