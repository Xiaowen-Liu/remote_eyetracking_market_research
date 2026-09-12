import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample, type GazeModel } from "../../apps/web/src/gazeMath";

type Point = readonly [number, number];
type CapturedSample = { x: number; y: number; at: string; url: string; viewport: { width: number; height: number }; scroll: { x: number; y: number } };
type FaceFrame = { detected: boolean; centered: boolean; inBounds: boolean; size: number };
const targets: Point[] = [[.12, .14], [.5, .14], [.88, .14], [.12, .5], [.5, .5], [.88, .5], [.12, .86], [.5, .86], [.88, .86]];
const boundaryTargets: Point[] = [[.12, .08], [.5, .08], [.88, .08], [.92, .5], [.88, .92], [.5, .92], [.12, .92], [.08, .5]];
const sampleIntervalMs = 100;
const checkWindowSize = 18;
const samplesPerTarget = 3;
const minimumFreshFrames = 12;
const accuracyDurationMs = 5_000;

let enabled = false;
let cameraReady = false;
let collecting = false;
let samples: CapturedSample[] = [];
let lastSampleAt = 0;
let latestFeature: Point | null = null;
let featureWindow: Point[] = [];
let calibrationIndex = 0;
let calibrationRepeat = 0;
let boundaryIndex = 0;
let calibrationSamples: CalibrationSample[] = [];
let model: GazeModel | null = null;
let calibrationStartedAt: string | null = null;
let featureFrameCount = 0;
let lastCalibrationFeatureFrame = 0;
let faceFrame: FaceFrame = { detected: false, centered: false, inBounds: false, size: 0 };
let calibrationStage: "camera" | "instructions" | "points" | "boundary" | "accuracy" | "submitting" = "camera";
let accuracyStartedAt: number | null = null;
let accuracyErrors: number[] = [];

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
    <aside data-webgaze-face-boundary hidden aria-live="polite"><span data-webgaze-face-outline></span><strong data-webgaze-face-boundary-status>Checking face position…</strong><small>Keep your face inside the guide while recording each sample.</small></aside>
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
  const stable = featureWindow.length >= checkWindowSize && motion(featureWindow) < .03 && faceFrame.inBounds;
  setCheck(root, "camera", hasCamera, hasCamera ? "Camera ready" : "Camera permission");
  setCheck(root, "face", hasFace, hasFace ? "Face landmarks detected" : "Face landmarks");
  setCheck(root, "steady", stable, stable ? "Position looks stable" : "Hold still briefly");
  const face = root.querySelector<HTMLElement>("[data-webgaze-face]")!;
  face.textContent = !hasFace ? "Position your face in the frame" : !faceFrame.inBounds ? "Move face inside boundary" : stable ? "Face detected · steady" : "Face detected · hold still";
  if (calibrationStage === "camera") root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = !stable;
  if (stable && !model && calibrationIndex === 0 && root.querySelector("[data-webgaze-phase]")!.textContent === "Camera check") root.querySelector("[data-webgaze-status]")!.textContent = "Camera check passed. Begin calibration when you are ready.";
}

function showTarget(root: HTMLDivElement) {
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  const button = root.querySelector<HTMLButtonElement>("[data-webgaze-calibrate]")!;
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  const activeTargets = calibrationStage === "boundary" ? boundaryTargets : targets;
  const activeIndex = calibrationStage === "boundary" ? boundaryIndex : calibrationIndex;
  const [x, y] = activeTargets[activeIndex]; target.hidden = false; button.hidden = false; progress.hidden = false;
  target.style.left = `${x * 100}%`; target.style.top = `${y * 100}%`;
  if (calibrationStage === "boundary") {
    button.textContent = `Capture boundary ${boundaryIndex + 1} of ${boundaryTargets.length}`;
    target.setAttribute("aria-label", `Capture boundary point ${boundaryIndex + 1} of ${boundaryTargets.length}`);
    root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Boundary point ${boundaryIndex + 1} of ${boundaryTargets.length}`;
    root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width = `${(boundaryIndex / boundaryTargets.length) * 100}%`;
  } else {
    const completed = calibrationIndex * samplesPerTarget + calibrationRepeat;
    button.textContent = `Record sample ${calibrationRepeat + 1} of ${samplesPerTarget}`;
    target.setAttribute("aria-label", `Record calibration point ${calibrationIndex + 1}, sample ${calibrationRepeat + 1} of ${samplesPerTarget}`);
    root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Point ${calibrationIndex + 1} of ${targets.length} · sample ${calibrationRepeat + 1} of ${samplesPerTarget}`;
    root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width = `${(completed / (targets.length * samplesPerTarget)) * 100}%`;
  }
  button.onclick = () => recordCalibration(root);
  target.onclick = () => recordCalibration(root);
}

function updateFaceBoundary(root: HTMLDivElement) {
  const panel = root.querySelector<HTMLElement>("[data-webgaze-face-boundary]")!;
  const outline = root.querySelector<HTMLElement>("[data-webgaze-face-outline]")!;
  const status = root.querySelector<HTMLElement>("[data-webgaze-face-boundary-status]")!;
  if (root.dataset.mode !== "calibration") { panel.hidden = true; return; }
  panel.hidden = false;
  outline.classList.toggle("passed", faceFrame.inBounds);
  outline.classList.toggle("warning", faceFrame.detected && !faceFrame.inBounds);
  status.textContent = !faceFrame.detected ? "Face not detected" : faceFrame.inBounds ? "Face inside boundary" : !faceFrame.centered ? "Center your face" : "Move slightly back into frame";
}

function showCalibrationInstructions(root: HTMLDivElement) {
  calibrationStage = "instructions";
  root.dataset.mode = "calibration-intro";
  root.querySelector("[data-webgaze-phase]")!.textContent = "Before calibration";
  root.querySelector("[data-webgaze-title]")!.textContent = "Before calibration";
  root.querySelector("[data-webgaze-status]")!.textContent = "Press each calibration button 3 times whilst looking at it. Follow the mouse with your eyes; keep your face and body as still as possible.";
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = false;
  const button = root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!;
  button.textContent = "Continue to calibration";
  button.onclick = () => beginCalibration(root);
}

function beginCalibration(root: HTMLDivElement) {
  calibrationStage = "points";
  calibrationStartedAt = new Date().toISOString(); calibrationIndex = 0; calibrationRepeat = 0; boundaryIndex = 0; calibrationSamples = []; featureWindow = []; lastCalibrationFeatureFrame = featureFrameCount; model = null; collecting = false; accuracyStartedAt = null; accuracyErrors = [];
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 1 of 3";
  // Keep the extension-origin iframe alive while it becomes visually transparent.
  // It owns the granted camera stream and continues emitting local face features.
  root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]")?.setAttribute("aria-hidden", "true");
  root.dataset.mode = "calibration";
  root.querySelector("[data-webgaze-title]")!.textContent = "Point calibration";
  root.querySelector("[data-webgaze-status]")!.textContent = `Look at the green dot, hold still, and record ${samplesPerTarget} samples before it moves.`;
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = true;
  updateFaceBoundary(root); showTarget(root);
}

function startBoundaryCalibration(root: HTMLDivElement) {
  calibrationStage = "boundary"; boundaryIndex = 0; featureWindow = []; lastCalibrationFeatureFrame = featureFrameCount;
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 2 of 3";
  root.querySelector("[data-webgaze-title]")!.textContent = "Boundary calibration";
  root.querySelector("[data-webgaze-status]")!.textContent = "Follow the highlighted path around the screen boundary, then capture each point.";
  showTarget(root);
}

function startAccuracyCheck(root: HTMLDivElement) {
  const next = fitGazeModel(calibrationSamples);
  if (!next) { retryCalibration(root); root.querySelector("[data-webgaze-status]")!.textContent = "Calibration did not fit. Please try again."; return; }
  model = next; calibrationStage = "accuracy"; accuracyStartedAt = null; accuracyErrors = [];
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 3 of 3";
  root.querySelector("[data-webgaze-title]")!.textContent = "Accuracy check";
  root.querySelector("[data-webgaze-status]")!.textContent = "Keep your eyes on the center dot until the measurement finishes.";
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  target.hidden = false; target.style.left = "50%"; target.style.top = "50%"; target.onclick = null;
  root.querySelector<HTMLButtonElement>("[data-webgaze-calibrate]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-webgaze-progress]")!.hidden = false;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = "Center gaze hold · 0.0 / 5.0 seconds";
  root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width = "0%";
}

function recordCalibration(root: HTMLDivElement) {
  const averaged = meanPoint(featureWindow);
  if (!faceFrame.inBounds) { root.querySelector("[data-webgaze-status]")!.textContent = "Move your face inside the boundary before recording this sample."; return; }
  if (featureFrameCount - lastCalibrationFeatureFrame < minimumFreshFrames) { root.querySelector("[data-webgaze-status]")!.textContent = "Keep looking at this dot briefly before recording the next sample."; return; }
  if (!averaged || featureWindow.length < checkWindowSize || motion(featureWindow) >= .04) { root.querySelector("[data-webgaze-status]")!.textContent = "Keep your face visible and steady for a moment, then record this sample again."; return; }
  const target = calibrationStage === "boundary" ? boundaryTargets[boundaryIndex] : targets[calibrationIndex];
  calibrationSamples = [...calibrationSamples, { feature: averaged, target }];
  calibrationRepeat += 1; lastCalibrationFeatureFrame = featureFrameCount; featureWindow = [];
  if (calibrationStage === "boundary") {
    boundaryIndex += 1; calibrationRepeat = 0;
    if (boundaryIndex < boundaryTargets.length) { root.querySelector("[data-webgaze-status]")!.textContent = "Next boundary point. Follow the highlighted path."; showTarget(root); return; }
    startAccuracyCheck(root); return;
  }
  if (calibrationRepeat < samplesPerTarget) { root.querySelector("[data-webgaze-status]")!.textContent = `Sample ${calibrationRepeat} of ${samplesPerTarget} saved. Keep looking at this dot.`; showTarget(root); return; }
  calibrationRepeat = 0;
  if (calibrationIndex < targets.length - 1) { calibrationIndex += 1; root.querySelector("[data-webgaze-status]")!.textContent = "Next point. Center your gaze on the green dot."; showTarget(root); return; }
  startBoundaryCalibration(root);
}

function completeCalibration(root: HTMLDivElement) {
  if (!model || calibrationStage === "submitting") return;
  calibrationStage = "submitting";
  const pointError = calibrationError(model, calibrationSamples);
  const accuracyError = accuracyErrors.length ? accuracyErrors.reduce((sum, value) => sum + value, 0) / accuracyErrors.length : Infinity;
  const rms = Math.max(pointError, accuracyError);
  if (rms > .18) { retryCalibration(root); root.querySelector("[data-webgaze-status]")!.textContent = `Calibration was weak (${(rms * 100).toFixed(1)}% RMS). Try again in steadier lighting.`; return; }
  root.querySelector("[data-webgaze-target]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-calibrate]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-progress]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-phase]")!.textContent = "Quality check"; root.querySelector("[data-webgaze-title]")!.textContent = "Calibration complete"; root.querySelector("[data-webgaze-status]")!.textContent = "Measurement complete. Submitting calibration quality…";
  root.querySelector<HTMLElement>("[data-webgaze-face-boundary]")!.hidden = true;
  void chrome.runtime.sendMessage({ type: "CALIBRATION_COMPLETED", calibration: { attempt: 1, startedAt: calibrationStartedAt ?? new Date().toISOString(), completedAt: new Date().toISOString(), observedSampleCount: calibrationSamples.length * checkWindowSize, errorPx: rms * Math.hypot(innerWidth, innerHeight), qualityGrade: rms <= .08 ? "strong" : "variable", rms } }).then((response) => {
    root.querySelector("[data-webgaze-phase]")!.textContent = response?.accepted ? "Ready" : "Calibration";
    root.dataset.mode = response?.accepted ? "ready" : "calibration";
    root.querySelector("[data-webgaze-status]")!.textContent = response?.accepted ? `Calibration accepted · ${(rms * 100).toFixed(1)}% RMS. Return to the extension to start Task 1.` : "Calibration was not accepted. Try again.";
  }).catch(() => { root.querySelector("[data-webgaze-status]")!.textContent = "Could not save calibration. Check the extension popup and retry."; });
}

async function startCamera(root: HTMLDivElement) {
  cameraCanvas(root);
}

function processFeature(root: HTMLDivElement, value: Point | null, frameData?: FaceFrame) {
  if (!enabled) return;
  featureFrameCount += 1; faceFrame = frameData ?? { detected: Boolean(value), centered: Boolean(value), inBounds: Boolean(value), size: 0 };
  latestFeature = value;
  if (latestFeature) featureWindow = [...featureWindow.slice(-(checkWindowSize - 1)), latestFeature]; else featureWindow = [];
  updateCameraCheck(root);
  updateFaceBoundary(root);
  if (latestFeature && model) {
    const [x, y] = predictGaze(model, latestFeature);
    const point = root.querySelector<HTMLElement>("[data-webgaze-dot]")!; point.style.left = `${x * 100}%`; point.style.top = `${y * 100}%`;
    if (calibrationStage === "accuracy") {
      const deviation = Math.hypot(x - .5, y - .5);
      const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
      if (!faceFrame.inBounds || deviation > .16) {
        accuracyStartedAt = null; accuracyErrors = [];
        root.querySelector("[data-webgaze-status]")!.textContent = "Keep your eyes on the center dot. The 5-second measurement will restart when your gaze returns.";
        root.querySelector("[data-webgaze-progress-copy]")!.textContent = "Center gaze hold · 0.0 / 5.0 seconds";
        progress.querySelector<HTMLElement>("b")!.style.width = "0%";
      } else {
        const now = performance.now(); accuracyStartedAt ??= now; accuracyErrors.push(deviation);
        const elapsed = now - accuracyStartedAt;
        root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Center gaze hold · ${(Math.min(elapsed, accuracyDurationMs) / 1000).toFixed(1)} / 5.0 seconds`;
        progress.querySelector<HTMLElement>("b")!.style.width = `${Math.min(100, elapsed / accuracyDurationMs * 100)}%`;
        if (elapsed >= accuracyDurationMs) completeCalibration(root);
      }
    }
    if (collecting) { const heat = document.createElement("i"); heat.className = "webgaze-heat-point"; heat.style.left = `${x * 100}%`; heat.style.top = `${y * 100}%`; root.querySelector("[data-webgaze-heat]")!.append(heat); if (root.querySelectorAll(".webgaze-heat-point").length > 90) heat.parentElement!.firstElementChild?.remove(); }
    const now = performance.now(); if (collecting && now - lastSampleAt >= sampleIntervalMs) { lastSampleAt = now; samples.push({ x, y, at: new Date().toISOString(), url: location.href, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } }); if (samples.length >= 10) { chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; } }
  }
}

function retryCalibration(root: HTMLDivElement) { calibrationStage = "points"; model = null; collecting = false; calibrationIndex = 0; calibrationRepeat = 0; boundaryIndex = 0; calibrationSamples = []; featureWindow = []; lastCalibrationFeatureFrame = featureFrameCount; calibrationStartedAt = new Date().toISOString(); accuracyStartedAt = null; accuracyErrors = []; root.dataset.mode = "calibration"; root.querySelector("[data-webgaze-phase]")!.textContent = "Calibration"; root.querySelector("[data-webgaze-title]")!.textContent = "Point calibration"; root.querySelector("[data-webgaze-status]")!.textContent = `Calibration needs another attempt. Record ${samplesPerTarget} samples at each point.`; updateFaceBoundary(root); showTarget(root); }
function stop() { enabled = false; cameraReady = false; collecting = false; model = null; calibrationIndex = 0; calibrationRepeat = 0; calibrationSamples = []; lastSampleAt = 0; document.querySelector("#webgaze-collector-overlay")?.remove(); if (samples.length) chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }

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
  if (message.type === "CAMERA_READY") {
    cameraReady = true; enabled = true;
    // Runtime readiness may be reported again after an iframe lifecycle event.
    // It is a health signal, never permission to reset an in-progress study.
    if (calibrationStage === "camera") featureWindow = [];
    return;
  }
  if (message.type === "CAMERA_FEATURE") processFeature(root, message.feature ?? null, message.face);
  if (message.type === "CAMERA_BEGIN_CALIBRATION") showCalibrationInstructions(root);
  if (message.type === "CAMERA_STOPPED") { enabled = false; cameraReady = false; calibrationStage = "camera"; root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]")?.remove(); root.dataset.mode = "camera"; cameraCanvas(root); }
});
