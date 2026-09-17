import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

type Point = readonly [number, number];
type FaceFrame = { detected: boolean; centered: boolean; inBounds: boolean; size: number };
let video: HTMLVideoElement | null = null;
let landmarker: FaceLandmarker | null = null;
let stream: MediaStream | null = null;
let frame: number | null = null;
let lastLightCheckAt = 0;
const lightCanvas = document.createElement("canvas");
lightCanvas.width = 64;
lightCanvas.height = 48;
const embedded = window.top !== window;

function feature(landmarks: NormalizedLandmark[]): Point | null {
  const leftIris = landmarks[468],
    rightIris = landmarks[473],
    leftOuter = landmarks[33],
    leftInner = landmarks[133],
    rightOuter = landmarks[263],
    rightInner = landmarks[362];
  if (![leftIris, rightIris, leftOuter, leftInner, rightOuter, rightInner].every(Boolean))
    return null;
  const leftWidth = Math.abs(leftOuter.x - leftInner.x) || 0.001,
    rightWidth = Math.abs(rightOuter.x - rightInner.x) || 0.001;
  return [
    ((leftIris.x - (leftOuter.x + leftInner.x) / 2) / leftWidth +
      (rightIris.x - (rightOuter.x + rightInner.x) / 2) / rightWidth) /
      2,
    ((leftIris.y - (leftOuter.y + leftInner.y) / 2) / leftWidth +
      (rightIris.y - (rightOuter.y + rightInner.y) / 2) / rightWidth) /
      2,
  ];
}

function faceFrame(landmarks: NormalizedLandmark[]): FaceFrame {
  if (!landmarks.length) return { detected: false, centered: false, inBounds: false, size: 0 };
  const xs = landmarks.map((landmark) => landmark.x),
    ys = landmarks.map((landmark) => landmark.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const width = maxX - minX,
    height = maxY - minY,
    size = Math.max(width, height);
  const centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2;
  const centered = Math.abs(centerX - 0.5) < 0.18 && Math.abs(centerY - 0.5) < 0.2;
  const inBounds =
    centered &&
    minX > 0.035 &&
    maxX < 0.965 &&
    minY > 0.035 &&
    maxY < 0.965 &&
    size > 0.17 &&
    size < 0.78;
  return { detected: true, centered, inBounds, size };
}

function updateEmbeddedDiagnostics(value: FaceFrame) {
  if (!embedded) return;
  const detection = document.querySelector<HTMLElement>("#detection");
  const distance = document.querySelector<HTMLElement>("#distance");
  const framing = document.querySelector<HTMLElement>("#framing");
  if (!detection || !distance || !framing) return;
  detection.textContent = value.detected ? "✓ Face found" : "○ Looking for a face";
  detection.dataset.passed = String(value.detected);
  const distanceOkay = value.detected && value.size >= 0.17 && value.size <= 0.78;
  distance.textContent = !value.detected
    ? "○ Distance unavailable"
    : distanceOkay
      ? "✓ Distance looks good"
      : value.size < 0.17
        ? "○ Move closer to the screen"
        : "○ Move farther from the screen";
  distance.dataset.passed = String(distanceOkay);
  framing.textContent = !value.detected
    ? "○ Framing unavailable"
    : value.centered
      ? "✓ Face is centered"
      : "○ Center your face in the frame";
  framing.dataset.passed = String(value.centered);
}

function updateLighting() {
  if (!embedded || !video || performance.now() - lastLightCheckAt < 500) return;
  lastLightCheckAt = performance.now();
  const output = document.querySelector<HTMLElement>("#lighting");
  const context = lightCanvas.getContext("2d", { willReadFrequently: true });
  if (!output || !context || !video.videoWidth) return;
  context.drawImage(video, 0, 0, lightCanvas.width, lightCanvas.height);
  const pixels = context.getImageData(0, 0, lightCanvas.width, lightCanvas.height).data;
  let luminance = 0;
  for (let index = 0; index < pixels.length; index += 4)
    luminance += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
  const average = luminance / (pixels.length / 4);
  const acceptable = average >= 55 && average <= 225;
  output.textContent = acceptable
    ? `✓ Lighting looks usable (${average.toFixed(0)}/255)`
    : average < 55
      ? `○ Add more light to your face (${average.toFixed(0)}/255)`
      : `○ Reduce bright backlighting (${average.toFixed(0)}/255)`;
  output.dataset.passed = String(acceptable);
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message?: unknown }).message ?? error);
  if (error && typeof error === "object" && "type" in error)
    return `MediaPipe runtime load error (${String((error as { type?: unknown }).type ?? "unknown")})`;
  return String(error);
}

function detect() {
  if (!video || !landmarker) return;
  const landmarks = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] ?? [];
  const value = feature(landmarks);
  const currentFace = faceFrame(landmarks);
  updateEmbeddedDiagnostics(currentFace);
  updateLighting();
  const message = {
    type: "CAMERA_FEATURE",
    source: "webgaze-camera-runtime",
    feature: value,
    face: currentFace,
    at: new Date().toISOString(),
    video: { width: video.videoWidth, height: video.videoHeight },
  };
  if (embedded) window.parent.postMessage(message, "*");
  else void chrome.runtime.sendMessage({ type: "OFFSCREEN_CAMERA_FEATURE", ...message });
  frame = requestAnimationFrame(detect);
}

async function start() {
  if (stream && landmarker) return { ok: true };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    stream.getVideoTracks()[0]?.addEventListener(
      "ended",
      () => {
        if (embedded)
          window.parent.postMessage(
            { type: "CAMERA_STOPPED", source: "webgaze-camera-runtime" },
            "*",
          );
      },
      { once: true },
    );
    video = embedded
      ? document.querySelector<HTMLVideoElement>("#preview")!
      : document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Camera stream started but no video frames arrived")),
        8000,
      );
      video!.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
    });
    await video.play().catch(() => undefined);
    const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("wasm"));
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    detect();
    if (embedded)
      window.parent.postMessage({ type: "CAMERA_READY", source: "webgaze-camera-runtime" }, "*");
    return { ok: true };
  } catch (error) {
    stop();
    return { ok: false, error: errorMessage(error) };
  }
}

function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  landmarker?.close();
  landmarker = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video = null;
}

if (embedded) {
  document.documentElement.innerHTML = `<head><style>html,body{height:100%;margin:0}body{align-items:center;background:#f6f8f5;color:#142018;display:flex;font:15px/1.45 system-ui,sans-serif;justify-content:center}.card{background:#fff;border:1px solid #dbe2e8;border-radius:24px;box-shadow:0 28px 70px #17231c2b;box-sizing:border-box;max-width:900px;padding:42px;text-align:center;width:calc(100% - 56px)}.eyebrow{color:#4e812f;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{border-bottom:1px solid #9da8b4;font-size:42px;letter-spacing:-.04em;margin:8px 0 20px;padding-bottom:14px}p{color:#58665b}.camera-grid{display:grid;gap:18px;grid-template-columns:minmax(300px,1.2fr) minmax(260px,.8fr);margin:22px 0}.preview{align-items:center;background:#eef3ec;border:1px solid #d9e1d6;border-radius:12px;display:flex;justify-content:center;overflow:hidden;position:relative;aspect-ratio:16/10}.preview video{height:100%;object-fit:cover;transform:scaleX(-1);width:100%}.badge{background:#ffffffdd;border:1px solid #dbe3d8;border-radius:99px;bottom:12px;color:#40533f;font-size:12px;left:50%;padding:5px 9px;position:absolute;transform:translateX(-50%);white-space:nowrap}.diagnostics{display:grid;gap:10px}.diagnostics div{align-items:center;background:#f7f9f6;border:1px solid #dce5da;border-radius:10px;color:#6c746d;display:flex;font-weight:650;padding:14px;text-align:left}.diagnostics div[data-passed="true"]{background:#effaf1;border-color:#9fdfaa;color:#176b33}button{background:#102038;border:0;border-radius:99px;color:white;cursor:pointer;font:700 16px system-ui;padding:13px 26px}.privacy{font-size:12px;margin:18px auto 0;max-width:580px}body.compact{background:#eef3ec;display:block;overflow:hidden}body.compact .card{border:0;border-radius:0;box-shadow:none;height:100%;max-width:none;padding:0;width:100%}body.compact .card>:not(.camera-grid){display:none}body.compact .camera-grid{display:block;height:100%;margin:0}body.compact .preview{border:0;border-radius:0;height:100%;margin:0;width:100%}body.compact .diagnostics,body.compact .badge{display:none}@media(max-width:720px){.card{padding:24px;width:calc(100% - 28px)}.camera-grid{grid-template-columns:1fr}h1{font-size:32px}}</style></head><body><main class="card"><div class="eyebrow">Experimental participant session</div><h1>Camera check</h1><p id="status">Before calibration, make sure your camera setup looks good.</p><div class="camera-grid"><div class="preview"><video id="preview" autoplay muted playsinline></video><span class="badge" id="badge">Camera is off</span></div><div class="diagnostics"><div id="detection" data-passed="false">○ Camera not started</div><div id="distance" data-passed="false">○ Distance unavailable</div><div id="framing" data-passed="false">○ Framing unavailable</div><div id="lighting" data-passed="false">○ Lighting unavailable</div></div></div><button id="start">Start camera check</button><p class="privacy">Camera frames and face landmarks stay inside this extension canvas. Only consented coordinate estimates are sent during an active task.</p></main></body>`;
  let readyToCalibrate = false;
  document.querySelector<HTMLButtonElement>("#start")!.addEventListener("click", () => {
    const status = document.querySelector<HTMLElement>("#status")!,
      badge = document.querySelector<HTMLElement>("#badge")!,
      button = document.querySelector<HTMLButtonElement>("#start")!;
    if (readyToCalibrate) {
      document.body.classList.add("compact");
      window.parent.postMessage(
        { type: "CAMERA_BEGIN_CALIBRATION", source: "webgaze-camera-runtime" },
        "*",
      );
      return;
    }
    status.textContent = "Requesting camera permission…";
    badge.textContent = "Waiting for permission";
    button.disabled = true;
    void start()
      .then((result) => {
        if (result.ok) {
          readyToCalibrate = true;
          status.textContent = "Review detection, distance, and framing, then continue.";
          badge.textContent = "Camera active";
          button.textContent = "Yes, continue";
          button.disabled = false;
        } else {
          status.textContent = `Camera check could not continue: ${result.error}`;
          badge.textContent = "Camera is off";
          button.textContent = "Try camera check again";
          button.disabled = false;
        }
      })
      .catch((error) => {
        status.textContent = `Camera check could not continue: ${errorMessage(error)}`;
        badge.textContent = "Camera is off";
        button.disabled = false;
      });
  });
} else {
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "OFFSCREEN_START_CAMERA") {
      void start().then(respond);
      return true;
    }
    if (message.type === "OFFSCREEN_STOP_CAMERA") {
      stop();
      respond({ ok: true });
    }
  });
}
