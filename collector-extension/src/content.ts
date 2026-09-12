import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample, type GazeModel } from "../../apps/web/src/gazeMath";

type Point = readonly [number, number];
type CapturedSample = { x: number; y: number; at: string; url: string; viewport: { width: number; height: number }; scroll: { x: number; y: number } };
const targets: Point[] = [[.12, .14], [.5, .14], [.88, .14], [.12, .5], [.5, .5], [.88, .5], [.12, .86], [.5, .86], [.88, .86]];
const sampleIntervalMs = 100;
const checkWindowSize = 18;

let landmarker: FaceLandmarker | null = null;
let video: HTMLVideoElement | null = null;
let frame: number | null = null;
let enabled = false;
let collecting = false;
let samples: CapturedSample[] = [];
let lastSampleAt = 0;
let latestFeature: Point | null = null;
let featureWindow: Point[] = [];
let calibrationIndex = 0;
let calibrationSamples: CalibrationSample[] = [];
let model: GazeModel | null = null;
let calibrationStartedAt: string | null = null;

function feature(landmarks: NormalizedLandmark[]): Point | null {
  const leftIris = landmarks[468], rightIris = landmarks[473], leftOuter = landmarks[33], leftInner = landmarks[133], rightOuter = landmarks[263], rightInner = landmarks[362];
  if (![leftIris, rightIris, leftOuter, leftInner, rightOuter, rightInner].every(Boolean)) return null;
  const leftWidth = Math.abs(leftOuter.x - leftInner.x) || .001, rightWidth = Math.abs(rightOuter.x - rightInner.x) || .001;
  return [((leftIris.x - (leftOuter.x + leftInner.x) / 2) / leftWidth + (rightIris.x - (rightOuter.x + rightInner.x) / 2) / rightWidth) / 2, ((leftIris.y - (leftOuter.y + leftInner.y) / 2) / leftWidth + (rightIris.y - (rightOuter.y + rightInner.y) / 2) / rightWidth) / 2];
}

function meanPoint(points: Point[]): Point | null {
  if (!points.length) return null;
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function motion(points: Point[]) {
  const center = meanPoint(points);
  if (!center || points.length < 2) return Infinity;
  return Math.sqrt(points.reduce((sum, point) => sum + (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2, 0) / points.length);
}

function overlay() {
  let root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay");
  if (root) return root;
  root = document.createElement("div"); root.id = "webgaze-collector-overlay";
  root.innerHTML = `<aside data-webgaze-panel aria-live="polite">
    <div class="webgaze-panel-head"><span>WebGaze</span><strong data-webgaze-phase>Camera check</strong></div>
    <p data-webgaze-status>Camera is off. Start the local camera check to continue.</p>
    <div class="webgaze-preview"><video data-webgaze-video muted playsinline></video><span data-webgaze-face>Waiting for camera</span></div>
    <ul data-webgaze-checks><li data-check="camera">○ Camera permission</li><li data-check="face">○ Face landmarks</li><li data-check="steady">○ Hold still briefly</li></ul>
    <p data-webgaze-privacy>Frames and face landmarks stay in this tab. Only consented coordinate estimates can be sent during a task.</p>
    <button type="button" data-webgaze-enable>Start camera check</button><button type="button" data-webgaze-begin hidden>Begin 9-point calibration</button><button type="button" data-webgaze-calibrate hidden>Hold still to record</button>
    <div data-webgaze-progress hidden><span data-webgaze-progress-copy></span><i><b></b></i></div>
    <i data-webgaze-target hidden></i><div data-webgaze-heat></div><i data-webgaze-dot></i>
  </aside>`;
  document.documentElement.append(root);
  root.querySelector<HTMLButtonElement>("[data-webgaze-enable]")!.onclick = () => void startCamera(root!);
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.onclick = () => beginCalibration(root!);
  return root;
}

function setCheck(root: HTMLDivElement, name: "camera" | "face" | "steady", passed: boolean, text: string) {
  const item = root.querySelector<HTMLElement>(`[data-check="${name}"]`)!;
  item.textContent = `${passed ? "✓" : "○"} ${text}`;
  item.classList.toggle("passed", passed);
}

function updateCameraCheck(root: HTMLDivElement) {
  const hasCamera = Boolean(video?.videoWidth && video.videoHeight);
  const hasFace = Boolean(latestFeature);
  const stable = featureWindow.length >= checkWindowSize && motion(featureWindow) < .03;
  setCheck(root, "camera", hasCamera, hasCamera ? "Camera ready" : "Camera permission");
  setCheck(root, "face", hasFace, hasFace ? "Face landmarks detected" : "Face landmarks");
  setCheck(root, "steady", stable, stable ? "Position looks stable" : "Hold still briefly");
  const face = root.querySelector<HTMLElement>("[data-webgaze-face]")!;
  face.textContent = hasFace ? (stable ? "Face detected · steady" : "Face detected · hold still") : "Position your face in the frame";
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = !stable;
  if (stable && !model && calibrationIndex === 0 && root.querySelector("[data-webgaze-phase]")!.textContent === "Camera check") root.querySelector("[data-webgaze-status]")!.textContent = "Camera check passed. Begin calibration when you are ready.";
}

function showTarget(root: HTMLDivElement) {
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  const button = root.querySelector<HTMLButtonElement>("[data-webgaze-calibrate]")!;
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  const [x, y] = targets[calibrationIndex]; target.hidden = false; button.hidden = false; progress.hidden = false;
  target.style.left = `${x * 100}%`; target.style.top = `${y * 100}%`;
  button.textContent = `Record point ${calibrationIndex + 1} of 9`;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Calibration point ${calibrationIndex + 1} of 9`;
  root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width = `${((calibrationIndex + 1) / targets.length) * 100}%`;
  button.onclick = () => recordCalibration(root);
}

function beginCalibration(root: HTMLDivElement) {
  calibrationStartedAt = new Date().toISOString(); calibrationIndex = 0; calibrationSamples = []; model = null; collecting = false;
  root.querySelector("[data-webgaze-phase]")!.textContent = "Calibration";
  root.querySelector("[data-webgaze-status]")!.textContent = "Look at the green dot, keep your head still, then record the point.";
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = true;
  showTarget(root);
}

function recordCalibration(root: HTMLDivElement) {
  const averaged = meanPoint(featureWindow);
  if (!averaged || featureWindow.length < checkWindowSize || motion(featureWindow) >= .04) { root.querySelector("[data-webgaze-status]")!.textContent = "Keep your face visible and steady for a moment, then record this point again."; return; }
  calibrationSamples = [...calibrationSamples, { feature: averaged, target: targets[calibrationIndex] }];
  if (calibrationIndex < targets.length - 1) { calibrationIndex += 1; showTarget(root); return; }
  const next = fitGazeModel(calibrationSamples);
  if (!next) { retryCalibration(root); root.querySelector("[data-webgaze-status]")!.textContent = "Calibration did not fit. Please try again."; return; }
  const error = calibrationError(next, calibrationSamples);
  if (error > .18) { retryCalibration(root); root.querySelector("[data-webgaze-status]")!.textContent = `Calibration was weak (${(error * 100).toFixed(1)}% RMS). Try again in steadier lighting.`; return; }
  model = next; root.querySelector("[data-webgaze-target]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-calibrate]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-progress]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-phase]")!.textContent = "Quality check"; root.querySelector("[data-webgaze-status]")!.textContent = "Submitting calibration quality…";
  const rms = error;
  void chrome.runtime.sendMessage({ type: "CALIBRATION_COMPLETED", calibration: { attempt: 1, startedAt: calibrationStartedAt ?? new Date().toISOString(), completedAt: new Date().toISOString(), observedSampleCount: calibrationSamples.length * checkWindowSize, errorPx: rms * Math.hypot(innerWidth, innerHeight), qualityGrade: rms <= .08 ? "strong" : "variable", rms } }).then((response) => {
    root.querySelector("[data-webgaze-phase]")!.textContent = response?.accepted ? "Ready" : "Calibration";
    root.querySelector("[data-webgaze-status]")!.textContent = response?.accepted ? `Calibration accepted · ${(rms * 100).toFixed(1)}% RMS. Return to the extension to start Task 1.` : "Calibration was not accepted. Try again.";
  }).catch(() => { root.querySelector("[data-webgaze-status]")!.textContent = "Could not save calibration. Check the extension popup and retry."; });
}

async function startCamera(root: HTMLDivElement) {
  try {
    root.querySelector("[data-webgaze-status]")!.textContent = "Requesting camera permission…";
    video = root.querySelector<HTMLVideoElement>("[data-webgaze-video]")!; video.muted = true; video.playsInline = true;
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    await video.play();
    root.querySelector("[data-webgaze-status]")!.textContent = "Loading on-device landmark model…";
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" }, runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6, minTrackingConfidence: .6 });
    enabled = true; collecting = false; featureWindow = []; root.querySelector<HTMLButtonElement>("[data-webgaze-enable]")!.remove(); root.querySelector("[data-webgaze-status]")!.textContent = "Complete the camera check: center your face and hold still."; tick(root);
  } catch (error) { root.querySelector("[data-webgaze-status]")!.textContent = error instanceof Error ? error.message : "Camera could not start"; }
}

function tick(root: HTMLDivElement) {
  if (!enabled || !video || !landmarker) return;
  latestFeature = feature(landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] ?? []);
  if (latestFeature) featureWindow = [...featureWindow.slice(-(checkWindowSize - 1)), latestFeature]; else featureWindow = [];
  updateCameraCheck(root);
  if (latestFeature && model) {
    const [x, y] = predictGaze(model, latestFeature);
    const point = root.querySelector<HTMLElement>("[data-webgaze-dot]")!; point.style.left = `${x * 100}%`; point.style.top = `${y * 100}%`;
    if (collecting) { const heat = document.createElement("i"); heat.className = "webgaze-heat-point"; heat.style.left = `${x * 100}%`; heat.style.top = `${y * 100}%`; root.querySelector("[data-webgaze-heat]")!.append(heat); if (root.querySelectorAll(".webgaze-heat-point").length > 90) heat.parentElement!.firstElementChild?.remove(); }
    const now = performance.now(); if (collecting && now - lastSampleAt >= sampleIntervalMs) { lastSampleAt = now; samples.push({ x, y, at: new Date().toISOString(), url: location.href, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } }); if (samples.length >= 10) { chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; } }
  }
  frame = requestAnimationFrame(() => tick(root));
}

function retryCalibration(root: HTMLDivElement) { model = null; collecting = false; calibrationIndex = 0; calibrationSamples = []; calibrationStartedAt = new Date().toISOString(); root.querySelector("[data-webgaze-phase]")!.textContent = "Calibration"; showTarget(root); }
function stop() { enabled = false; collecting = false; model = null; calibrationIndex = 0; calibrationSamples = []; lastSampleAt = 0; if (frame) cancelAnimationFrame(frame); landmarker?.close(); video?.srcObject && (video.srcObject as MediaStream).getTracks().forEach((track) => track.stop()); document.querySelector("#webgaze-collector-overlay")?.remove(); if (samples.length) chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "COLLECTOR_ARM") overlay();
  if (message.type === "COLLECTOR_START_TASK") { collecting = true; const root = overlay(); root.querySelector("[data-webgaze-phase]")!.textContent = "Collecting"; root.querySelector("[data-webgaze-status]")!.textContent = `Collecting coordinate estimates for ${message.taskTitle ?? "current task"}.`; }
  if (message.type === "COLLECTOR_DRAIN_SAMPLES") { const drained = samples; samples = []; collecting = false; const root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay"); if (root) { root.querySelector("[data-webgaze-phase]")!.textContent = "Ready"; root.querySelector("[data-webgaze-status]")!.textContent = "Task saved. Return to the extension for the next task."; } respond({ samples: drained }); }
  if (message.type === "COLLECTOR_RETRY_CALIBRATION") retryCalibration(overlay());
  if (message.type === "COLLECTOR_STOP") stop();
});
