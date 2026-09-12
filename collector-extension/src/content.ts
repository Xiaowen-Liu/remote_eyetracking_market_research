import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample, type GazeModel } from "../../apps/web/src/gazeMath";
import { createBoundaryPath, hasArrived, observeSegment, pointerSpeed } from "../core/boundary-calibration.js";

type Point = readonly [number, number];
type PixelPoint = { x: number; y: number };
type CapturedSample = { x: number; y: number; at: string; url: string; viewport: { width: number; height: number }; scroll: { x: number; y: number } };
type FaceFrame = { detected: boolean; centered: boolean; inBounds: boolean; size: number };
const targets: Point[] = [[.16, .14], [.5, .14], [.84, .14], [.16, .5], [.5, .5], [.84, .5], [.16, .8], [.5, .8], [.84, .8]];
const sampleIntervalMs = 100;
const checkWindowSize = 18;
const samplesPerTarget = 3;
const accuracyDurationMs = 5_000;
const boundaryInsetPx = 28;
const boundaryCornerClicksRequired = 2;
const boundaryPassiveIntervalMs = 120;
const boundaryCornerRadiusPx = 34;
const boundaryRailTolerancePx = 56;
const boundaryArrivalRadiusPx = 52;
const boundaryMaxSpeedPxMs = 1.2;
const boundaryRecoveryHoldMs = 350;

let enabled = false;
let cameraReady = false;
let collecting = false;
let samples: CapturedSample[] = [];
let lastSampleAt = 0;
let latestFeature: Point | null = null;
let featureWindow: Point[] = [];
let calibrationIndex = 0;
let calibrationRepeat = 0;
let calibrationSamples: CalibrationSample[] = [];
let model: GazeModel | null = null;
let calibrationStartedAt: string | null = null;
let faceFrame: FaceFrame = { detected: false, centered: false, inBounds: false, size: 0 };
let calibrationStage: "camera" | "setup" | "instructions" | "points-intro" | "points" | "boundary-intro" | "boundary" | "accuracy-intro" | "accuracy" | "result" | "submitting" = "camera";
let accuracyAccumulatedMs = 0;
let accuracyLastFrameAt: number | null = null;
let accuracyErrors: number[] = [];
let boundaryMode: "corner" | "trace" = "corner";
let boundaryCornerIndex = 0;
let boundaryCornerClicks = 0;
let boundaryAnchorRecorded = false;
let boundaryNeedsRecovery = false;
let boundaryRecoverySince: number | null = null;
let boundaryLastPassiveAt = 0;
let boundaryLastPointer: (PixelPoint & { at: number; speed: number }) | null = null;
let boundaryTimer: number | null = null;
let boundaryRoot: HTMLDivElement | null = null;

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
        <button type="button" data-webgaze-enable>Start camera check</button><button type="button" data-webgaze-secondary hidden></button><button type="button" data-webgaze-begin hidden>Begin 9-point calibration</button><button type="button" data-webgaze-calibrate hidden>Record point</button>
      </div>
    </main>
    <footer data-webgaze-progress hidden><strong data-webgaze-calibration-status></strong><span data-webgaze-progress-copy></span><i><b></b></i></footer>
    <i data-webgaze-boundary-guide hidden></i><i data-webgaze-target hidden></i><div data-webgaze-heat></div><i data-webgaze-dot></i>
  </section>`;
  document.documentElement.append(root);
  root.querySelector<HTMLButtonElement>("[data-webgaze-enable]")!.onclick = () => void startCamera(root!);
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.onclick = () => beginCalibration(root!);
  return root;
}

function setCalibrationStatus(root: HTMLDivElement, text: string) {
  root.querySelector<HTMLElement>("[data-webgaze-calibration-status]")!.textContent = text;
  root.querySelector<HTMLElement>("[data-webgaze-status]")!.textContent = text;
}

function showCalibrationModal(root: HTMLDivElement, options: { stage: typeof calibrationStage; phase: string; title: string; status: string; primary: string; onPrimary: () => void; secondary?: string; onSecondary?: () => void; secondaryDisabled?: boolean }) {
  calibrationStage = options.stage;
  root.dataset.mode = "calibration-intro";
  root.querySelector<HTMLElement>("[data-webgaze-phase]")!.textContent = options.phase;
  root.querySelector<HTMLElement>("[data-webgaze-title]")!.textContent = options.title;
  root.querySelector<HTMLElement>("[data-webgaze-status]")!.textContent = options.status;
  root.querySelector<HTMLElement>("[data-webgaze-target]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-webgaze-boundary-guide]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-webgaze-progress]")!.hidden = true;
  root.querySelector<HTMLButtonElement>("[data-webgaze-enable]")!.hidden = true;
  root.querySelector<HTMLButtonElement>("[data-webgaze-calibrate]")!.hidden = true;
  const primary = root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!;
  primary.hidden = false;
  primary.disabled = false;
  primary.textContent = options.primary;
  primary.onclick = options.onPrimary;
  const secondary = root.querySelector<HTMLButtonElement>("[data-webgaze-secondary]")!;
  secondary.hidden = !options.secondary;
  secondary.disabled = Boolean(options.secondaryDisabled);
  secondary.textContent = options.secondary ?? "";
  secondary.onclick = options.onSecondary ?? null;
}

async function showCalibrationSetup(root: HTMLDivElement) {
  const stored = await chrome.storage.local.get("webgazeCalibration").catch(() => ({}));
  const saved = stored.webgazeCalibration as { model?: GazeModel; rms?: number; savedAt?: string } | undefined;
  showCalibrationModal(root, {
    stage: "setup",
    phase: "Calibration setup",
    title: "Calibration setup",
    status: saved?.model ? `A saved calibration from ${new Date(saved.savedAt ?? Date.now()).toLocaleDateString()} is available.` : "Start a new calibration to map your gaze to this screen.",
    primary: "Calibrate",
    onPrimary: () => showCalibrationInstructions(root),
    secondary: "Close & load saved model",
    secondaryDisabled: !saved?.model,
    onSecondary: () => { if (saved?.model) void acceptSavedCalibration(root, saved.model, saved.rms ?? .12); },
  });
}

async function acceptSavedCalibration(root: HTMLDivElement, savedModel: GazeModel, rms: number) {
  model = savedModel;
  calibrationStartedAt = new Date().toISOString();
  await submitCalibration(root, rms, 0);
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

function showPointTarget(root: HTMLDivElement) {
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  const [x, y] = targets[calibrationIndex]; target.hidden = false; progress.hidden = false;
  target.style.left = `${x * 100}%`; target.style.top = `${y * 100}%`;
  target.textContent = `${calibrationRepeat + 1}/${samplesPerTarget}`;
  target.style.pointerEvents = "auto";
  const completed = calibrationIndex * samplesPerTarget + calibrationRepeat;
  target.setAttribute("aria-label", `Record calibration point ${calibrationIndex + 1}, sample ${calibrationRepeat + 1} of ${samplesPerTarget}`);
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Point ${calibrationIndex + 1} of ${targets.length} · sample ${calibrationRepeat + 1} of ${samplesPerTarget}`;
  root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width = `${(completed / (targets.length * samplesPerTarget)) * 100}%`;
  target.onclick = () => recordCalibration(root);
}

function showCalibrationInstructions(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "instructions",
    phase: "Before calibration",
    title: "Before calibration",
    status: "Follow the cursor with your eyes while moving slowly. Keep your head still and do not look ahead to the next target.",
    primary: "Continue to calibration",
    onPrimary: () => showPointCalibrationIntro(root),
  });
}

function showPointCalibrationIntro(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "points-intro",
    phase: "Step 1 of 3",
    title: "Step 1 of 3: Point calibration",
    status: "Click each highlighted point 3 times while looking directly at it. Targets appear one at a time, row by row.",
    primary: "OK",
    onPrimary: () => beginCalibration(root),
  });
}

function beginCalibration(root: HTMLDivElement) {
  calibrationStage = "points";
  cleanupBoundaryCalibration();
  calibrationStartedAt = new Date().toISOString(); calibrationIndex = 0; calibrationRepeat = 0; calibrationSamples = []; model = null; collecting = false; accuracyAccumulatedMs = 0; accuracyLastFrameAt = null; accuracyErrors = [];
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 1 of 3";
  // The extension-origin iframe owns the granted stream while remaining hidden
  // after camera check so camera frames continue to be processed locally.
  root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]")?.setAttribute("aria-hidden", "true");
  root.dataset.mode = "calibration";
  root.dataset.calibrationStep = "points";
  root.querySelector("[data-webgaze-title]")!.textContent = "Point calibration";
  setCalibrationStatus(root, `Look at each green dot and click it ${samplesPerTarget} times while keeping your head still.`);
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = true;
  showPointTarget(root);
}

function showBoundaryCalibrationIntro(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "boundary-intro",
    phase: "Step 2 of 3",
    title: "Step 2 of 3: Boundary calibration",
    status: "Click each corner target twice, then move the cursor slowly along the highlighted edge while keeping your eyes on it.",
    primary: "OK",
    onPrimary: () => startBoundaryCalibration(root),
  });
}

function startBoundaryCalibration(root: HTMLDivElement) {
  cleanupBoundaryCalibration();
  calibrationStage = "boundary"; boundaryMode = "corner"; boundaryCornerIndex = 0; boundaryCornerClicks = 0;
  boundaryRoot = root;
  root.dataset.mode = "calibration";
  root.dataset.calibrationStep = "boundary";
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 2 of 3";
  root.querySelector("[data-webgaze-title]")!.textContent = "Boundary calibration";
  window.addEventListener("mousemove", onBoundaryMouseMove, { passive: true });
  window.addEventListener("click", onBoundaryClick);
  boundaryTimer = window.setInterval(processBoundaryTimer, 50);
  showBoundaryCorner(root);
}

function boundaryPath() {
  return createBoundaryPath(innerWidth, innerHeight, boundaryInsetPx) as PixelPoint[];
}

function normalizePixelPoint(point: PixelPoint): Point {
  return [point.x / innerWidth, point.y / innerHeight];
}

function positionBoundaryGuide(root: HTMLDivElement, start: PixelPoint, end: PixelPoint) {
  const guide = root.querySelector<HTMLElement>("[data-webgaze-boundary-guide]")!;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  guide.hidden = false;
  guide.style.left = `${start.x}px`;
  guide.style.top = `${start.y}px`;
  guide.style.width = `${length}px`;
  guide.style.transform = `rotate(${Math.atan2(end.y - start.y, end.x - start.x)}rad)`;
}

function addCalibrationSample(target: Point, weight = 1) {
  const averaged = meanPoint(featureWindow);
  if (!averaged) return false;
  for (let index = 0; index < weight; index += 1) calibrationSamples.push({ feature: averaged, target });
  return true;
}

function showBoundaryCorner(root: HTMLDivElement) {
  boundaryMode = "corner";
  boundaryCornerClicks = 0;
  boundaryRecoverySince = null;
  root.querySelector<HTMLElement>("[data-webgaze-boundary-guide]")!.hidden = true;
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  const corner = boundaryPath()[boundaryCornerIndex];
  target.hidden = false;
  target.style.left = `${corner.x}px`;
  target.style.top = `${corner.y}px`;
  target.style.pointerEvents = "none";
  target.textContent = `0/${boundaryCornerClicksRequired}`;
  target.setAttribute("aria-label", `Boundary corner ${boundaryCornerIndex + 1}, click 1 of ${boundaryCornerClicksRequired}`);
  target.onclick = null;
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  progress.hidden = false;
  progress.querySelector<HTMLElement>("b")!.style.width = `${(boundaryCornerIndex / 4) * 100}%`;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Boundary corner ${boundaryCornerIndex + 1} of 5 · click 0 of 2`;
  setCalibrationStatus(root, boundaryCornerIndex === 4 ? "Close the loop: look at the starting corner and click it twice." : "Look at the corner target and click it twice.");
}

function recordBoundaryCorner(root: HTMLDivElement, event: MouseEvent) {
  if (calibrationStage !== "boundary" || boundaryMode !== "corner") return;
  const corner = boundaryPath()[boundaryCornerIndex];
  if (Math.hypot(event.clientX - corner.x, event.clientY - corner.y) > boundaryCornerRadiusPx) return;
  if (!faceFrame.inBounds) { setCalibrationStatus(root, "Move your face inside the guide before recording this corner."); return; }
  if (featureWindow.length < 3 || motion(featureWindow) >= .08) { setCalibrationStatus(root, "Keep your face steady, then click this corner again."); return; }
  if (!addCalibrationSample(normalizePixelPoint(corner), 2)) return;
  boundaryCornerClicks += 1;
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  target.textContent = `${boundaryCornerClicks}/${boundaryCornerClicksRequired}`;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Boundary corner ${boundaryCornerIndex + 1} of 5 · click ${boundaryCornerClicks} of 2`;
  if (boundaryCornerClicks < boundaryCornerClicksRequired) { setCalibrationStatus(root, "Corner sample saved. Keep looking here and click once more."); return; }
  if (boundaryCornerIndex === 4) { cleanupBoundaryCalibration(); showAccuracyCheckIntro(root); return; }
  startBoundaryTrace(root);
}

function onBoundaryClick(event: MouseEvent) {
  if (boundaryRoot) recordBoundaryCorner(boundaryRoot, event);
}

function startBoundaryTrace(root: HTMLDivElement) {
  boundaryMode = "trace";
  boundaryAnchorRecorded = false;
  boundaryNeedsRecovery = false;
  boundaryRecoverySince = null;
  boundaryLastPassiveAt = 0;
  boundaryLastPointer = null;
  const path = boundaryPath();
  const start = path[boundaryCornerIndex];
  const end = path[boundaryCornerIndex + 1];
  positionBoundaryGuide(root, start, end);
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  target.style.left = `${end.x}px`;
  target.style.top = `${end.y}px`;
  target.style.pointerEvents = "none";
  target.textContent = "";
  target.onclick = null;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Trace edge ${boundaryCornerIndex + 1} of 4`;
  setCalibrationStatus(root, "Slowly follow the dashed edge with your mouse while keeping your eyes on the cursor.");
}

function recordBoundaryTraceSample(point: PixelPoint, weight = 1) {
  if (!faceFrame.inBounds || !latestFeature || featureWindow.length < 2) return false;
  return addCalibrationSample(normalizePixelPoint(point), weight);
}

function processBoundaryPointer(root: HTMLDivElement, point: PixelPoint, now: number, speed: number) {
  if (calibrationStage !== "boundary" || boundaryMode !== "trace") return;
  const path = boundaryPath();
  const observation = observeSegment(path[boundaryCornerIndex], path[boundaryCornerIndex + 1], point);
  const onRail = observation.distance <= boundaryRailTolerancePx && observation.progress >= -.03 && observation.progress <= 1.05;
  const slowEnough = speed <= boundaryMaxSpeedPxMs;

  if (!onRail) { boundaryRecoverySince = null; return; }
  if (!slowEnough) {
    boundaryRecoverySince = null;
    if (observation.progress >= .75) {
      boundaryNeedsRecovery = true;
      setCalibrationStatus(root, "That movement was too fast. Return to the middle, pause briefly, then move slowly toward the corner.");
    }
    return;
  }

  if (now - boundaryLastPassiveAt >= boundaryPassiveIntervalMs && recordBoundaryTraceSample(point)) boundaryLastPassiveAt = now;
  if (!boundaryAnchorRecorded && observation.progress >= .45 && observation.progress <= .75) {
    if (!boundaryNeedsRecovery) {
      boundaryAnchorRecorded = recordBoundaryTraceSample(point, 3);
    } else {
      boundaryRecoverySince ??= now;
      if (now - boundaryRecoverySince >= boundaryRecoveryHoldMs) {
        boundaryAnchorRecorded = recordBoundaryTraceSample(point, 3);
        boundaryNeedsRecovery = false;
      } else {
        setCalibrationStatus(root, "Good. Hold briefly in the middle, then continue slowly toward the corner.");
      }
    }
  } else if (!boundaryAnchorRecorded && boundaryNeedsRecovery) {
    boundaryRecoverySince = null;
  }

  if (!hasArrived(observation, boundaryArrivalRadiusPx, boundaryRailTolerancePx)) return;
  if (!boundaryAnchorRecorded) {
    boundaryNeedsRecovery = true;
    boundaryRecoverySince = null;
    setCalibrationStatus(root, "Return to the middle of this edge, hold for a moment, then approach the corner slowly.");
    return;
  }
  boundaryCornerIndex += 1;
  showBoundaryCorner(root);
}

function onBoundaryMouseMove(event: MouseEvent) {
  if (!boundaryRoot || calibrationStage !== "boundary" || boundaryMode !== "trace") return;
  const now = performance.now();
  const current = { x: event.clientX, y: event.clientY };
  const speed = pointerSpeed(boundaryLastPointer, current, boundaryLastPointer ? now - boundaryLastPointer.at : 0);
  boundaryLastPointer = { ...current, at: now, speed };
  processBoundaryPointer(boundaryRoot, current, now, speed);
}

function processBoundaryTimer() {
  if (!boundaryRoot || !boundaryLastPointer || boundaryMode !== "trace" || !boundaryNeedsRecovery) return;
  processBoundaryPointer(boundaryRoot, boundaryLastPointer, performance.now(), 0);
}

function cleanupBoundaryCalibration() {
  boundaryRoot?.querySelector<HTMLElement>("[data-webgaze-boundary-guide]")?.setAttribute("hidden", "");
  window.removeEventListener("mousemove", onBoundaryMouseMove);
  window.removeEventListener("click", onBoundaryClick);
  if (boundaryTimer !== null) window.clearInterval(boundaryTimer);
  boundaryTimer = null;
  boundaryRoot = null;
  boundaryLastPointer = null;
  boundaryRecoverySince = null;
}

function showAccuracyCheckIntro(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "accuracy-intro",
    phase: "Step 3 of 3",
    title: "Step 3 of 3: Accuracy check",
    status: "Do not move your mouse. Look at the center dot for 5 seconds while the ring completes. Natural blinking is okay.",
    primary: "OK",
    onPrimary: () => startAccuracyCheck(root),
  });
}

function startAccuracyCheck(root: HTMLDivElement) {
  cleanupBoundaryCalibration();
  const next = fitGazeModel(calibrationSamples);
  if (!next) { retryCalibration(root); setCalibrationStatus(root, "Calibration did not fit. Please try again."); return; }
  model = next; calibrationStage = "accuracy"; accuracyAccumulatedMs = 0; accuracyLastFrameAt = null; accuracyErrors = [];
  root.dataset.mode = "calibration";
  root.dataset.calibrationStep = "accuracy";
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 3 of 3";
  root.querySelector("[data-webgaze-title]")!.textContent = "Accuracy check";
  setCalibrationStatus(root, "Keep your eyes on the center dot until the measurement finishes.");
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  target.hidden = false; target.style.left = "50%"; target.style.top = "50%"; target.style.pointerEvents = "none"; target.textContent = ""; target.onclick = null;
  root.querySelector<HTMLButtonElement>("[data-webgaze-calibrate]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-webgaze-progress]")!.hidden = false;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = "Center gaze hold · 0.0 / 5.0 seconds";
  root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width = "0%";
}

function recordCalibration(root: HTMLDivElement) {
  const averaged = meanPoint(featureWindow);
  if (!faceFrame.inBounds) { setCalibrationStatus(root, "Move your face inside the boundary before recording this sample."); return; }
  if (!averaged || featureWindow.length < 3 || motion(featureWindow) >= .08) { setCalibrationStatus(root, "Keep your face visible and steady, then click this point again."); return; }
  const target = targets[calibrationIndex];
  calibrationSamples = [...calibrationSamples, { feature: averaged, target }];
  calibrationRepeat += 1;
  if (calibrationRepeat < samplesPerTarget) { setCalibrationStatus(root, `Sample ${calibrationRepeat} of ${samplesPerTarget} saved. Keep looking at this dot.`); showPointTarget(root); return; }
  calibrationRepeat = 0;
  if (calibrationIndex < targets.length - 1) { calibrationIndex += 1; setCalibrationStatus(root, "Next point. Center your gaze on the green dot."); showPointTarget(root); return; }
  showBoundaryCalibrationIntro(root);
}

function completeCalibration(root: HTMLDivElement) {
  if (!model || calibrationStage === "submitting" || calibrationStage === "result") return;
  const pointError = calibrationError(model, calibrationSamples);
  const accuracyError = accuracyErrors.length ? accuracyErrors.reduce((sum, value) => sum + value, 0) / accuracyErrors.length : pointError;
  const rms = Math.max(pointError, accuracyError);
  const displayedAccuracy = Math.min(100, Math.max(0, rms * 100));
  showCalibrationModal(root, {
    stage: "result",
    phase: "Accuracy result",
    title: `Your accuracy measure is ${displayedAccuracy.toFixed(0)}%`,
    status: rms <= .18 ? "Calibration is ready to use for this study." : "Accuracy is outside the recommended range. You can recalibrate or continue with the recorded quality value.",
    primary: "OK",
    onPrimary: () => void submitCalibration(root, rms, calibrationSamples.length * checkWindowSize),
    secondary: "Recalibrate",
    onSecondary: () => showCalibrationInstructions(root),
  });
}

async function submitCalibration(root: HTMLDivElement, rms: number, observedSampleCount: number) {
  if (!model || calibrationStage === "submitting") return;
  calibrationStage = "submitting";
  const primary = root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!;
  const secondary = root.querySelector<HTMLButtonElement>("[data-webgaze-secondary]")!;
  primary.disabled = true;
  secondary.disabled = true;
  root.querySelector<HTMLElement>("[data-webgaze-status]")!.textContent = "Saving calibration quality…";
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "CALIBRATION_COMPLETED", calibration: { attempt: 1, startedAt: calibrationStartedAt ?? new Date().toISOString(), completedAt: new Date().toISOString(), observedSampleCount, errorPx: rms * Math.hypot(innerWidth, innerHeight), qualityGrade: rms <= .08 ? "strong" : "variable", rms } }),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("The study API did not respond in time")), 15_000)),
    ]);
    if (!response?.ok) throw new Error(response?.error ?? "The study API did not accept the calibration");
    root.querySelector("[data-webgaze-phase]")!.textContent = response?.accepted ? "Ready" : "Calibration";
    root.dataset.mode = response?.accepted ? "ready" : "calibration-intro";
    root.querySelector("[data-webgaze-status]")!.textContent = response?.accepted ? `Calibration accepted · ${(rms * 100).toFixed(1)}% RMS. Return to the extension to start Task 1.` : "Calibration was not accepted. Recalibrate and try again.";
    if (response?.accepted) {
      await chrome.storage.local.set({ webgazeCalibration: { model, rms, savedAt: new Date().toISOString() } });
      primary.hidden = true;
      secondary.hidden = true;
    } else {
      calibrationStage = "result";
      primary.disabled = false;
      secondary.disabled = false;
    }
  } catch (error) {
    calibrationStage = "result";
    primary.disabled = false;
    secondary.disabled = false;
    const message = error instanceof Error ? error.message : "Unknown save error";
    root.querySelector("[data-webgaze-status]")!.textContent = `Could not save calibration: ${message}. Try OK again or recalibrate.`;
  }
}

async function startCamera(root: HTMLDivElement) {
  cameraCanvas(root);
}

function updateAccuracyCheck(root: HTMLDivElement, predicted: Point | null) {
  const now = performance.now();
  const frameDelta = accuracyLastFrameAt === null ? 0 : now - accuracyLastFrameAt;
  accuracyLastFrameAt = now;
  const deviation = predicted ? Math.hypot(predicted[0] - .5, predicted[1] - .5) : Infinity;
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  accuracyAccumulatedMs += frameDelta;
  if (predicted) accuracyErrors.push(deviation);
  setCalibrationStatus(root, predicted ? "Keep your eyes on the center dot. Measurement is continuous and will not reset." : "Tracking was briefly unavailable; the measurement is continuing.");

  const elapsed = Math.min(accuracyAccumulatedMs, accuracyDurationMs);
  root.querySelector("[data-webgaze-progress-copy]")!.textContent = `Center gaze · ${(elapsed / 1000).toFixed(1)} / 5.0 seconds`;
  progress.querySelector<HTMLElement>("b")!.style.width = `${Math.min(100, elapsed / accuracyDurationMs * 100)}%`;
  if (accuracyAccumulatedMs >= accuracyDurationMs) completeCalibration(root);
}

function processFeature(root: HTMLDivElement, value: Point | null, frameData?: FaceFrame) {
  if (!enabled) return;
  faceFrame = frameData ?? { detected: Boolean(value), centered: Boolean(value), inBounds: Boolean(value), size: 0 };
  latestFeature = value;
  if (latestFeature) featureWindow = [...featureWindow.slice(-(checkWindowSize - 1)), latestFeature]; else featureWindow = [];
  updateCameraCheck(root);
  const predicted = latestFeature && model ? predictGaze(model, latestFeature) : null;
  if (calibrationStage === "accuracy" && model) updateAccuracyCheck(root, predicted);
  if (predicted) {
    const [x, y] = predicted;
    const point = root.querySelector<HTMLElement>("[data-webgaze-dot]")!; point.style.left = `${x * 100}%`; point.style.top = `${y * 100}%`;
    if (collecting) { const heat = document.createElement("i"); heat.className = "webgaze-heat-point"; heat.style.left = `${x * 100}%`; heat.style.top = `${y * 100}%`; root.querySelector("[data-webgaze-heat]")!.append(heat); if (root.querySelectorAll(".webgaze-heat-point").length > 90) heat.parentElement!.firstElementChild?.remove(); }
    const now = performance.now(); if (collecting && now - lastSampleAt >= sampleIntervalMs) { lastSampleAt = now; samples.push({ x, y, at: new Date().toISOString(), url: location.href, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } }); if (samples.length >= 10) { chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; } }
  }
}

function retryCalibration(root: HTMLDivElement) { cleanupBoundaryCalibration(); calibrationStage = "points"; model = null; collecting = false; calibrationIndex = 0; calibrationRepeat = 0; calibrationSamples = []; calibrationStartedAt = new Date().toISOString(); accuracyAccumulatedMs = 0; accuracyLastFrameAt = null; accuracyErrors = []; root.dataset.mode = "calibration"; root.dataset.calibrationStep = "points"; root.querySelector("[data-webgaze-phase]")!.textContent = "Calibration"; root.querySelector("[data-webgaze-title]")!.textContent = "Point calibration"; setCalibrationStatus(root, `Calibration needs another attempt. Click each point ${samplesPerTarget} times.`); showPointTarget(root); }
function stop() { cleanupBoundaryCalibration(); enabled = false; cameraReady = false; collecting = false; model = null; calibrationIndex = 0; calibrationRepeat = 0; calibrationSamples = []; lastSampleAt = 0; document.querySelector("#webgaze-collector-overlay")?.remove(); if (samples.length) chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }

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
  if (message.type === "CAMERA_BEGIN_CALIBRATION") void showCalibrationSetup(root);
  if (message.type === "CAMERA_STOPPED") { enabled = false; cameraReady = false; calibrationStage = "camera"; root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]")?.remove(); root.dataset.mode = "camera"; cameraCanvas(root); }
});
