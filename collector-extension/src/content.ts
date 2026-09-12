import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample, type GazeModel } from "../../apps/web/src/gazeMath";

type Point = readonly [number, number];
type CapturedSample = { x: number; y: number; at: string; url: string; viewport: { width: number; height: number }; scroll: { x: number; y: number } };
const targets: Point[] = [[.12, .14], [.5, .14], [.88, .14], [.12, .5], [.5, .5], [.88, .5], [.12, .86], [.5, .86], [.88, .86]];
const sampleIntervalMs = 100;
const checkWindowSize = 18;

let enabled = false;
let cameraReady = false;
let collecting = false;
let samples: CapturedSample[] = [];
let lastSampleAt = 0;
let latestFeature: Point | null = null;
let featureWindow: Point[] = [];
let calibrationIndex = 0;
let calibrationSamples: CalibrationSample[] = [];
let model: GazeModel | null = null;
let calibrationStartedAt: string | null = null;

function cameraCanvas(root: HTMLDivElement) {
  let canvas = root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]");
  if (canvas) return canvas;
  root.dataset.mode = "camera-runtime";
  canvas = document.createElement("iframe"); canvas.dataset.webgazeCameraCanvas = ""; canvas.title = "WebGaze camera check"; canvas.allow = "camera"; canvas.src = chrome.runtime.getURL("camera.html");
  root.append(canvas);
  return canvas;
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
  root.dataset.mode = "camera";
  root.innerHTML = `<section data-webgaze-panel aria-live="polite">
    <header class="webgaze-panel-head"><span>WebGaze research</span><strong data-webgaze-phase>Camera check</strong></header>
    <main data-webgaze-stage>
      <div class="webgaze-intro">
        <p class="webgaze-eyebrow">Experimental participant session</p>
        <h1 data-webgaze-title>Check your camera</h1>
        <p data-webgaze-status>Camera is off. Start the local camera check to continue.</p>
        <div class="webgaze-preview"><span data-webgaze-face>Waiting for camera</span></div>
        <ul data-webgaze-checks><li data-check="camera">○ Camera permission</li><li data-check="face">○ Face landmarks</li><li data-check="steady">○ Hold still briefly</li></ul>
        <p data-webgaze-privacy>Camera frames and face landmarks remain in this browser tab. During an active task, the study API receives consented coordinate estimates, time, scroll position, and viewport context.</p>
        <button type="button" data-webgaze-enable>Start camera check</button><button type="button" data-webgaze-begin hidden>Begin 9-point calibration</button><button type="button" data-webgaze-calibrate hidden>Record point</button>
      </div>
    </main>
    <footer data-webgaze-progress hidden><span data-webgaze-progress-copy></span><i><b></b></i></footer>
    <i data-webgaze-target hidden></i><div data-webgaze-heat></div><i data-webgaze-dot></i>
  </section>`;
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
  const hasCamera = cameraReady;
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
  target.onclick = () => recordCalibration(root);
}

function beginCalibration(root: HTMLDivElement) {
  calibrationStartedAt = new Date().toISOString(); calibrationIndex = 0; calibrationSamples = []; featureWindow = []; model = null; collecting = false;
  root.querySelector("[data-webgaze-phase]")!.textContent = "Calibration";
  // Keep the extension-origin iframe alive while it becomes visually transparent.
  // It owns the granted camera stream and continues emitting local face features.
  root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]")?.setAttribute("aria-hidden", "true");
  root.dataset.mode = "calibration";
  root.querySelector("[data-webgaze-status]")!.textContent = "Look at the green dot, hold still briefly, then click the dot or record the point.";
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
    root.dataset.mode = response?.accepted ? "ready" : "calibration";
    root.querySelector("[data-webgaze-status]")!.textContent = response?.accepted ? `Calibration accepted · ${(rms * 100).toFixed(1)}% RMS. Return to the extension to start Task 1.` : "Calibration was not accepted. Try again.";
  }).catch(() => { root.querySelector("[data-webgaze-status]")!.textContent = "Could not save calibration. Check the extension popup and retry."; });
}

async function startCamera(root: HTMLDivElement) {
  cameraCanvas(root);
}

function processFeature(root: HTMLDivElement, value: Point | null) {
  if (!enabled) return;
  latestFeature = value;
  if (latestFeature) featureWindow = [...featureWindow.slice(-(checkWindowSize - 1)), latestFeature]; else featureWindow = [];
  updateCameraCheck(root);
  if (latestFeature && model) {
    const [x, y] = predictGaze(model, latestFeature);
    const point = root.querySelector<HTMLElement>("[data-webgaze-dot]")!; point.style.left = `${x * 100}%`; point.style.top = `${y * 100}%`;
    if (collecting) { const heat = document.createElement("i"); heat.className = "webgaze-heat-point"; heat.style.left = `${x * 100}%`; heat.style.top = `${y * 100}%`; root.querySelector("[data-webgaze-heat]")!.append(heat); if (root.querySelectorAll(".webgaze-heat-point").length > 90) heat.parentElement!.firstElementChild?.remove(); }
    const now = performance.now(); if (collecting && now - lastSampleAt >= sampleIntervalMs) { lastSampleAt = now; samples.push({ x, y, at: new Date().toISOString(), url: location.href, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } }); if (samples.length >= 10) { chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; } }
  }
}

function retryCalibration(root: HTMLDivElement) { model = null; collecting = false; calibrationIndex = 0; calibrationSamples = []; calibrationStartedAt = new Date().toISOString(); root.dataset.mode = "calibration"; root.querySelector("[data-webgaze-phase]")!.textContent = "Calibration"; showTarget(root); }
function stop() { enabled = false; cameraReady = false; collecting = false; model = null; calibrationIndex = 0; calibrationSamples = []; lastSampleAt = 0; document.querySelector("#webgaze-collector-overlay")?.remove(); if (samples.length) chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "COLLECTOR_ARM") overlay();
  if (message.type === "COLLECTOR_START_TASK") { collecting = true; const root = overlay(); root.dataset.mode = "task"; root.querySelector("[data-webgaze-phase]")!.textContent = "Collecting"; root.querySelector("[data-webgaze-status]")!.textContent = `Collecting coordinate estimates for ${message.taskTitle ?? "current task"}.`; }
  if (message.type === "COLLECTOR_DRAIN_SAMPLES") { const drained = samples; samples = []; collecting = false; const root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay"); if (root) { root.querySelector("[data-webgaze-phase]")!.textContent = "Ready"; root.querySelector("[data-webgaze-status]")!.textContent = "Task saved. Return to the extension for the next task."; } respond({ samples: drained }); }
  if (message.type === "COLLECTOR_RETRY_CALIBRATION") retryCalibration(overlay());
  if (message.type === "COLLECTOR_STOP") stop();
});

window.addEventListener("message", (event) => {
  const root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay");
  const canvas = root?.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]");
  const message = event.data;
  if (!root || !canvas || event.source !== canvas.contentWindow || message?.source !== "webgaze-camera-runtime") return;
  if (message.type === "CAMERA_READY") { cameraReady = true; enabled = true; collecting = false; featureWindow = []; return; }
  if (message.type === "CAMERA_FEATURE") processFeature(root, message.feature ?? null);
  if (message.type === "CAMERA_BEGIN_CALIBRATION") beginCalibration(root);
});
