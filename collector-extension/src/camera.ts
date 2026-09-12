import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

type Point = readonly [number, number];
let video: HTMLVideoElement | null = null;
let landmarker: FaceLandmarker | null = null;
let stream: MediaStream | null = null;
let frame: number | null = null;
const embedded = window.top !== window;

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
  const message = { type: "CAMERA_FEATURE", source: "webgaze-camera-runtime", feature: value, at: new Date().toISOString(), video: { width: video.videoWidth, height: video.videoHeight } };
  if (embedded) window.parent.postMessage(message, "*"); else void chrome.runtime.sendMessage({ type: "OFFSCREEN_CAMERA_FEATURE", ...message });
  frame = requestAnimationFrame(detect);
}

async function start() {
  if (stream && landmarker) return { ok: true };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video = embedded ? document.querySelector<HTMLVideoElement>("#preview")! : document.createElement("video"); video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = stream;
    await new Promise<void>((resolve, reject) => { const timeout = window.setTimeout(() => reject(new Error("Camera stream started but no video frames arrived")), 8000); video!.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(); }; });
    await video.play().catch(() => undefined);
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" }, runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6, minTrackingConfidence: .6 });
    detect();
    if (embedded) window.parent.postMessage({ type: "CAMERA_READY", source: "webgaze-camera-runtime" }, "*");
    return { ok: true };
  } catch (error) {
    stop();
    return { ok: false, error: errorMessage(error) };
  }
}

function stop() { if (frame) cancelAnimationFrame(frame); frame = null; landmarker?.close(); landmarker = null; stream?.getTracks().forEach((track) => track.stop()); stream = null; video = null; }

if (embedded) {
  document.documentElement.innerHTML = `<head><style>html,body{height:100%;margin:0}body{align-items:center;background:#fff;color:#142018;display:flex;font:15px/1.45 system-ui,sans-serif;justify-content:center}.card{max-width:520px;padding:32px;text-align:center}.eyebrow{color:#4e812f;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{font:500 54px/.98 Georgia,serif;letter-spacing:-.05em;margin:10px 0 16px}p{color:#58665b}.preview{align-items:center;background:#eef3ec;border:1px solid #d9e1d6;border-radius:12px;display:flex;justify-content:center;margin:22px auto 14px;max-width:420px;overflow:hidden;position:relative;aspect-ratio:16/10}.preview video{height:100%;object-fit:cover;transform:scaleX(-1);width:100%}.badge{background:#ffffffdd;border:1px solid #dbe3d8;border-radius:99px;bottom:12px;color:#40533f;font-size:12px;left:50%;padding:5px 9px;position:absolute;transform:translateX(-50%);white-space:nowrap}button{background:#1d3727;border:0;border-radius:7px;color:white;cursor:pointer;font:700 15px system-ui;padding:12px 22px}.privacy{font-size:12px;margin:18px auto 0;max-width:450px}</style></head><body><main class="card"><div class="eyebrow">Experimental participant session</div><h1>Check your camera</h1><p id="status">Start the camera check to request permission from this visible extension canvas.</p><div class="preview"><video id="preview" autoplay muted playsinline></video><span class="badge" id="badge">Camera is off</span></div><button id="start">Start camera check</button><p class="privacy">Camera frames and face landmarks stay inside this extension canvas. The study receives only consented coordinate estimates during an active task.</p></main></body>`;
  let readyToCalibrate = false;
  document.querySelector<HTMLButtonElement>("#start")!.addEventListener("click", () => {
    const status = document.querySelector<HTMLElement>("#status")!, badge = document.querySelector<HTMLElement>("#badge")!, button = document.querySelector<HTMLButtonElement>("#start")!;
    if (readyToCalibrate) { window.parent.postMessage({ type: "CAMERA_BEGIN_CALIBRATION", source: "webgaze-camera-runtime" }, "*"); return; }
    status.textContent = "Requesting camera permission…"; badge.textContent = "Waiting for permission"; button.disabled = true;
    void start().then((result) => {
    if (result.ok) { readyToCalibrate = true; status.textContent = "Camera is ready. Center your face and hold still, then begin calibration."; badge.textContent = "Camera active"; button.textContent = "Begin 9-point calibration"; button.disabled = false; }
    else { status.textContent = `Camera check could not continue: ${result.error}`; badge.textContent = "Camera is off"; button.textContent = "Try camera check again"; button.disabled = false; }
    }).catch((error) => { status.textContent = `Camera check could not continue: ${errorMessage(error)}`; badge.textContent = "Camera is off"; button.disabled = false; });
  });
} else {
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "OFFSCREEN_START_CAMERA") { void start().then(respond); return true; }
    if (message.type === "OFFSCREEN_STOP_CAMERA") { stop(); respond({ ok: true }); }
  });
}
