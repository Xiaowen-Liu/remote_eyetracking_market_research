import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

type Point = readonly [number, number];
let video: HTMLVideoElement | null = null;
let landmarker: FaceLandmarker | null = null;
let stream: MediaStream | null = null;
let frame: number | null = null;

function feature(landmarks: NormalizedLandmark[]): Point | null {
  const leftIris = landmarks[468], rightIris = landmarks[473], leftOuter = landmarks[33], leftInner = landmarks[133], rightOuter = landmarks[263], rightInner = landmarks[362];
  if (![leftIris, rightIris, leftOuter, leftInner, rightOuter, rightInner].every(Boolean)) return null;
  const leftWidth = Math.abs(leftOuter.x - leftInner.x) || .001, rightWidth = Math.abs(rightOuter.x - rightInner.x) || .001;
  return [((leftIris.x - (leftOuter.x + leftInner.x) / 2) / leftWidth + (rightIris.x - (rightOuter.x + rightInner.x) / 2) / rightWidth) / 2, ((leftIris.y - (leftOuter.y + leftInner.y) / 2) / leftWidth + (rightIris.y - (rightOuter.y + rightInner.y) / 2) / rightWidth) / 2];
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

function detect() {
  if (!video || !landmarker) return;
  const value = feature(landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] ?? []);
  void chrome.runtime.sendMessage({ type: "OFFSCREEN_CAMERA_FEATURE", feature: value, at: new Date().toISOString(), video: { width: video.videoWidth, height: video.videoHeight } });
  frame = requestAnimationFrame(detect);
}

async function start() {
  if (stream && landmarker) return { ok: true };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video = document.createElement("video"); video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = stream;
    await new Promise<void>((resolve, reject) => { const timeout = window.setTimeout(() => reject(new Error("Camera stream started but no video frames arrived")), 8000); video!.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(); }; });
    await video.play().catch(() => undefined);
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" }, runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6, minTrackingConfidence: .6 });
    detect();
    return { ok: true };
  } catch (error) {
    stop();
    return { ok: false, error: errorMessage(error) };
  }
}

function stop() { if (frame) cancelAnimationFrame(frame); frame = null; landmarker?.close(); landmarker = null; stream?.getTracks().forEach((track) => track.stop()); stream = null; video = null; }

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "OFFSCREEN_START_CAMERA") { void start().then(respond); return true; }
  if (message.type === "OFFSCREEN_STOP_CAMERA") { stop(); respond({ ok: true }); }
});
