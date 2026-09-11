import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample, type GazeFeature, type GazeModel } from "./gazeMath";

const targets: ReadonlyArray<readonly [number, number]> = [[.12, .14], [.5, .14], [.88, .14], [.12, .5], [.5, .5], [.88, .5], [.12, .86], [.5, .86], [.88, .86]];

function feature(landmarks: NormalizedLandmark[]): GazeFeature | null {
  const leftIris = landmarks[468]; const rightIris = landmarks[473];
  const leftOuter = landmarks[33]; const leftInner = landmarks[133];
  const rightOuter = landmarks[263]; const rightInner = landmarks[362];
  if (![leftIris, rightIris, leftOuter, leftInner, rightOuter, rightInner].every(Boolean)) return null;
  const center = (first: NormalizedLandmark, second: NormalizedLandmark) => [(first.x + second.x) / 2, (first.y + second.y) / 2] as GazeFeature;
  const [leftX, leftY] = center(leftOuter, leftInner); const [rightX, rightY] = center(rightOuter, rightInner);
  const leftWidth = Math.abs(leftOuter.x - leftInner.x) || .001; const rightWidth = Math.abs(rightOuter.x - rightInner.x) || .001;
  return [((leftIris.x - leftX) / leftWidth + (rightIris.x - rightX) / rightWidth) / 2, ((leftIris.y - leftY) / leftWidth + (rightIris.y - rightY) / rightWidth) / 2];
}

type Props = { collecting: boolean; sampleIntervalMs: number; onCalibrated: (quality: number) => void; onGazeSample: (point: GazeFeature, confidence: number) => void };

export function LiveGazeCapture({ collecting, sampleIntervalMs, onCalibrated, onGazeSample }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null); const landmarkerRef = useRef<FaceLandmarker | null>(null); const frameRef = useRef<number | null>(null);
  const featureRef = useRef<GazeFeature | null>(null); const modelRef = useRef<GazeModel | null>(null); const lastEmit = useRef(0);
  const [started, setStarted] = useState(false); const [foundFace, setFoundFace] = useState(false); const [pointIndex, setPointIndex] = useState(0);
  const [samples, setSamples] = useState<CalibrationSample[]>([]); const [gaze, setGaze] = useState<GazeFeature | null>(null); const [message, setMessage] = useState("Allow camera to begin local calibration.");
  const [attempt, setAttempt] = useState(1); const [quality, setQuality] = useState<number | null>(null); const [heat, setHeat] = useState<GazeFeature[]>([]);

  useEffect(() => () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); landmarkerRef.current?.close(); (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop()); }, []);
  useEffect(() => { if (!started) return; const frame = () => { const video = videoRef.current; const landmarker = landmarkerRef.current; if (!video || !landmarker) return; const next = feature(landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] ?? []); featureRef.current = next; setFoundFace(Boolean(next)); if (next && modelRef.current) { const predicted = predictGaze(modelRef.current, next); setGaze(predicted); if (collecting && performance.now() - lastEmit.current >= sampleIntervalMs) { lastEmit.current = performance.now(); setHeat((current) => [...current.slice(-79), predicted]); onGazeSample(predicted, Math.max(.2, 1 - (quality ?? .2) * 3)); } } frameRef.current = requestAnimationFrame(frame); }; frame(); return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); }; }, [collecting, onGazeSample, quality, sampleIntervalMs, started]);

  async function start() {
    try { setMessage("Loading on-device landmark model…"); const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); if (!videoRef.current) return; videoRef.current.srcObject = stream; await videoRef.current.play(); const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"); landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" }, runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6, minTrackingConfidence: .6 }); setStarted(true); setMessage("Face landmarks run locally. Look at each calibration dot, then record it."); } catch (error) { setMessage(error instanceof Error ? error.message : "Camera access could not start."); }
  }
  function retry() { modelRef.current = null; setSamples([]); setPointIndex(0); setQuality(null); setHeat([]); setAttempt((value) => value + 1); setMessage("Retry calibration: look at each dot before recording it."); }
  function record() { if (!featureRef.current) { setMessage("Face not detected. Keep both eyes visible and try again."); return; } const next = [...samples, { feature: featureRef.current, target: targets[pointIndex] }]; setSamples(next); if (pointIndex < targets.length - 1) { setPointIndex((value) => value + 1); return; } const model = fitGazeModel(next); if (!model) { setMessage("Calibration did not fit. Try again."); return; } const nextQuality = calibrationError(model, next); setQuality(nextQuality); if (nextQuality > .18) { setMessage(`Calibration quality is weak (${(nextQuality * 100).toFixed(1)}% RMS). Retry in steadier lighting.`); return; } modelRef.current = model; setMessage(`Calibration accepted locally (${(nextQuality * 100).toFixed(1)}% RMS).`); onCalibrated(nextQuality); }

  return <div className="live-gaze-capture"><div className="camera-frame"><video ref={videoRef} muted playsInline /><span className={foundFace ? "camera-state ready" : "camera-state"}>{foundFace ? "Face landmarks detected" : "Waiting for face"}</span></div><p className="fine-print">{message}</p>{!started && <button className="primary-button" type="button" onClick={() => void start()}>Allow camera and calibrate</button>}{started && !modelRef.current && <div className="participant-calibration-board"><button type="button" className="calibration-target" style={{ left: `${targets[pointIndex][0] * 100}%`, top: `${targets[pointIndex][1] * 100}%` }} onClick={record} /><p>Attempt {attempt} · Point {pointIndex + 1} of 9</p><button className="secondary-button" type="button" onClick={record}>Record calibration point</button>{quality !== null && <button className="secondary-button retry-calibration" type="button" onClick={retry}>Retry calibration</button>}</div>}{modelRef.current && <div className="participant-live-preview"><span>{collecting ? "Collecting coordinate samples" : "Calibration ready"} · {(quality! * 100).toFixed(1)}% RMS</span>{heat.map((point, index) => <i className="heat-point" key={`${index}-${point[0]}`} style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }} />)}{gaze && <i className="gaze-cursor" style={{ left: `${gaze[0] * 100}%`, top: `${gaze[1] * 100}%` }} />}</div>}</div>;
}
