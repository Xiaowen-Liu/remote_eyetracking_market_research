import {
  fitGazeModel,
  predictGaze,
  type CalibrationSample,
  type GazeModel,
} from "../../apps/web/src/gazeMath";
import {
  createBoundaryPath,
  hasArrived,
  observeSegment,
  pointerSpeed,
} from "../core/boundary-calibration.js";
import { summarizeAccuracy } from "../core/accuracy-check.js";

type Point = readonly [number, number];
type PixelPoint = { x: number; y: number };
type CapturedSample = {
  x: number;
  y: number;
  at: string;
  url: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
};
type FaceFrame = { detected: boolean; centered: boolean; inBounds: boolean; size: number };
type CalibrationStage =
  | "camera"
  | "setup"
  | "instructions"
  | "points-intro"
  | "points"
  | "boundary-intro"
  | "boundary"
  | "accuracy-intro"
  | "accuracy"
  | "result"
  | "submitting";
type CalibrationRuntime = {
  calibrationIndex: number;
  calibrationRepeat: number;
  calibrationSamples: CalibrationSample[];
  calibrationStartedAt: string | null;
  calibrationStage: CalibrationStage;
  accuracyStartedAt: number | null;
  accuracyTimer: number | null;
  accuracyPredictions: Point[];
  boundaryMode: "corner" | "trace";
  boundaryCornerIndex: number;
  boundaryCornerClicks: number;
  boundaryAnchorRecorded: boolean;
  boundaryNeedsRecovery: boolean;
  boundaryRecoverySince: number | null;
  boundaryLastPassiveAt: number;
  boundaryLastPointer: (PixelPoint & { at: number; speed: number }) | null;
  boundaryTimer: number | null;
  boundaryRoot: HTMLDivElement | null;
};
const targets: Point[] = [
  [0.16, 0.14],
  [0.5, 0.14],
  [0.84, 0.14],
  [0.16, 0.5],
  [0.5, 0.5],
  [0.84, 0.5],
  [0.16, 0.8],
  [0.5, 0.8],
  [0.84, 0.8],
];
const defaultSampleIntervalMs = 50;
const checkWindowSize = 18;
const samplesPerTarget = 3;
const accuracyDurationMs = 5_000;
const accuracyTickMs = 70;
const accuracySampleLimit = 50;
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
let sampleIntervalMs = defaultSampleIntervalMs;
const heatPoints: HTMLElement[] = [];
let latestFeature: Point | null = null;
let featureWindow: Point[] = [];
let model: GazeModel | null = null;
let faceFrame: FaceFrame = { detected: false, centered: false, inBounds: false, size: 0 };
const runtime: CalibrationRuntime = {
  calibrationIndex: 0,
  calibrationRepeat: 0,
  calibrationSamples: [],
  calibrationStartedAt: null,
  calibrationStage: "camera",
  accuracyStartedAt: null,
  accuracyTimer: null,
  accuracyPredictions: [],
  boundaryMode: "corner",
  boundaryCornerIndex: 0,
  boundaryCornerClicks: 0,
  boundaryAnchorRecorded: false,
  boundaryNeedsRecovery: false,
  boundaryRecoverySince: null,
  boundaryLastPassiveAt: 0,
  boundaryLastPointer: null,
  boundaryTimer: null,
  boundaryRoot: null,
};
let sampleFlush = Promise.resolve();

function clampCoordinate(value: number) {
  return Math.min(1, Math.max(0, value));
}

function flushSamples() {
  if (!samples.length) return sampleFlush;
  const batch = samples;
  samples = [];
  sampleFlush = sampleFlush
    .then(async () => {
      const response = await chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples: batch });
      if (!response?.ok) throw new Error(response?.error ?? "Gaze batch was not acknowledged");
    })
    .catch(() => {
      samples = [...batch, ...samples];
    });
  return sampleFlush;
}

function cameraCanvas(root: HTMLDivElement) {
  let canvas = root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]");
  if (canvas) return canvas;
  root.dataset.mode = "camera-runtime";
  canvas = document.createElement("iframe");
  canvas.dataset.webgazeCameraCanvas = "";
  canvas.title = "WebGaze camera check";
  canvas.allow = "camera";
  canvas.src = chrome.runtime.getURL("camera.html");
  root.append(canvas);
  return canvas;
}

function meanPoint(points: Point[]): Point | null {
  if (!points.length) return null;
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function motion(points: Point[]) {
  const center = meanPoint(points);
  if (!center || points.length < 2) return Infinity;
  return Math.sqrt(
    points.reduce(
      (sum, point) => sum + (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2,
      0,
    ) / points.length,
  );
}

function overlay() {
  let root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay");
  if (root) return root;
  root = document.createElement("div");
  root.id = "webgaze-collector-overlay";
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
  root.querySelector<HTMLButtonElement>("[data-webgaze-enable]")!.onclick = () =>
    void startCamera(root!);
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.onclick = () =>
    beginCalibration(root!);
  return root;
}

function setCalibrationStatus(root: HTMLDivElement, text: string) {
  root.querySelector<HTMLElement>("[data-webgaze-calibration-status]")!.textContent = text;
  root.querySelector<HTMLElement>("[data-webgaze-status]")!.textContent = text;
}

function showCalibrationModal(
  root: HTMLDivElement,
  options: {
    stage: typeof runtime.calibrationStage;
    phase: string;
    title: string;
    status: string;
    primary: string;
    onPrimary: () => void;
    secondary?: string;
    onSecondary?: () => void;
    secondaryDisabled?: boolean;
  },
) {
  runtime.calibrationStage = options.stage;
  root.dataset.mode = "calibration-intro";
  root.dataset.calibrationStep = options.stage;
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
  const saved = stored.webgazeCalibration as
    { model?: GazeModel; rms?: number; savedAt?: string } | undefined;
  showCalibrationModal(root, {
    stage: "setup",
    phase: "Calibration setup",
    title: "Calibration setup",
    status: saved?.model
      ? `A saved calibration from ${new Date(saved.savedAt ?? Date.now()).toLocaleDateString()} is available.`
      : "Start a new calibration to map your gaze to this screen.",
    primary: "Calibrate",
    onPrimary: () => showCalibrationInstructions(root),
    secondary: "Close & load saved model",
    secondaryDisabled: !saved?.model,
    onSecondary: () => {
      if (saved?.model) void acceptSavedCalibration(root, saved.model, saved.rms ?? 0.12);
    },
  });
}

async function acceptSavedCalibration(root: HTMLDivElement, savedModel: GazeModel, rms: number) {
  model = savedModel;
  runtime.calibrationStartedAt = new Date().toISOString();
  await submitCalibration(root, rms, 0);
}

function setCheck(
  root: HTMLDivElement,
  name: "camera" | "face" | "steady",
  passed: boolean,
  text: string,
) {
  const item = root.querySelector<HTMLElement>(`[data-check="${name}"]`)!;
  item.textContent = `${passed ? "✓" : "○"} ${text}`;
  item.classList.toggle("passed", passed);
}

function updateCameraCheck(root: HTMLDivElement) {
  const hasCamera = cameraReady;
  const hasFace = Boolean(latestFeature);
  const stable =
    featureWindow.length >= checkWindowSize && motion(featureWindow) < 0.03 && faceFrame.inBounds;
  setCheck(root, "camera", hasCamera, hasCamera ? "Camera ready" : "Camera permission");
  setCheck(root, "face", hasFace, hasFace ? "Face landmarks detected" : "Face landmarks");
  setCheck(root, "steady", stable, stable ? "Position looks stable" : "Hold still briefly");
  const face = root.querySelector<HTMLElement>("[data-webgaze-face]")!;
  face.textContent = !hasFace
    ? "Position your face in the frame"
    : !faceFrame.inBounds
      ? "Move face inside boundary"
      : stable
        ? "Face detected · steady"
        : "Face detected · hold still";
  if (runtime.calibrationStage === "camera")
    root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = !stable;
  if (
    stable &&
    !model &&
    runtime.calibrationIndex === 0 &&
    root.querySelector("[data-webgaze-phase]")!.textContent === "Camera check"
  )
    root.querySelector("[data-webgaze-status]")!.textContent =
      "Camera check passed. Begin calibration when you are ready.";
}

function showPointTarget(root: HTMLDivElement) {
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  const [x, y] = targets[runtime.calibrationIndex];
  target.hidden = false;
  progress.hidden = false;
  target.style.left = `${x * 100}%`;
  target.style.top = `${y * 100}%`;
  target.textContent = `${runtime.calibrationRepeat + 1}/${samplesPerTarget}`;
  target.style.pointerEvents = "auto";
  const completed = runtime.calibrationIndex * samplesPerTarget + runtime.calibrationRepeat;
  target.setAttribute(
    "aria-label",
    `Record calibration point ${runtime.calibrationIndex + 1}, sample ${runtime.calibrationRepeat + 1} of ${samplesPerTarget}`,
  );
  root.querySelector("[data-webgaze-progress-copy]")!.textContent =
    `Point ${runtime.calibrationIndex + 1} of ${targets.length} · sample ${runtime.calibrationRepeat + 1} of ${samplesPerTarget}`;
  root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width =
    `${(completed / (targets.length * samplesPerTarget)) * 100}%`;
  target.onclick = () => recordCalibration(root);
}

function showCalibrationInstructions(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "instructions",
    phase: "Before calibration",
    title: "Before calibration",
    status:
      "Follow the cursor with your eyes while moving slowly. Keep your head still and do not look ahead to the next target.",
    primary: "Continue to calibration",
    onPrimary: () => showPointCalibrationIntro(root),
  });
}

function showPointCalibrationIntro(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "points-intro",
    phase: "Step 1 of 3",
    title: "Step 1 of 3: Point calibration",
    status:
      "Click each highlighted point 3 times while looking directly at it. Targets appear one at a time, row by row.",
    primary: "OK",
    onPrimary: () => beginCalibration(root),
  });
}

function beginCalibration(root: HTMLDivElement) {
  runtime.calibrationStage = "points";
  cleanupBoundaryCalibration();
  runtime.calibrationStartedAt = new Date().toISOString();
  runtime.calibrationIndex = 0;
  runtime.calibrationRepeat = 0;
  runtime.calibrationSamples = [];
  model = null;
  collecting = false;
  cleanupAccuracyCheck();
  runtime.accuracyPredictions = [];
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 1 of 3";
  // The extension-origin iframe owns the granted stream while remaining hidden
  // after camera check so camera frames continue to be processed locally.
  root
    .querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]")
    ?.setAttribute("aria-hidden", "true");
  root.dataset.mode = "calibration";
  root.dataset.calibrationStep = "points";
  root.querySelector("[data-webgaze-title]")!.textContent = "Point calibration";
  setCalibrationStatus(
    root,
    `Look at each green dot and click it ${samplesPerTarget} times while keeping your head still.`,
  );
  root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!.hidden = true;
  showPointTarget(root);
}

function showBoundaryCalibrationIntro(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "boundary-intro",
    phase: "Step 2 of 3",
    title: "Step 2 of 3: Boundary calibration",
    status:
      "Click each corner target twice, then move the cursor slowly along the highlighted edge while keeping your eyes on it.",
    primary: "OK",
    onPrimary: () => startBoundaryCalibration(root),
  });
}

function startBoundaryCalibration(root: HTMLDivElement) {
  cleanupBoundaryCalibration();
  runtime.calibrationStage = "boundary";
  runtime.boundaryMode = "corner";
  runtime.boundaryCornerIndex = 0;
  runtime.boundaryCornerClicks = 0;
  runtime.boundaryRoot = root;
  root.dataset.mode = "calibration";
  root.dataset.calibrationStep = "boundary";
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 2 of 3";
  root.querySelector("[data-webgaze-title]")!.textContent = "Boundary calibration";
  root.querySelector<HTMLElement>("[data-webgaze-status]")!.textContent = "";
  root.querySelector<HTMLElement>("[data-webgaze-calibration-status]")!.textContent = "";
  window.addEventListener("mousemove", onBoundaryMouseMove, { passive: true });
  // Capture clicks before the underlying study page can stop propagation.
  window.addEventListener("click", onBoundaryClick, true);
  runtime.boundaryTimer = window.setInterval(processBoundaryTimer, 50);
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
  for (let index = 0; index < weight; index += 1)
    runtime.calibrationSamples.push({ feature: averaged, target });
  return true;
}

function showBoundaryCorner(root: HTMLDivElement) {
  runtime.boundaryMode = "corner";
  runtime.boundaryCornerClicks = 0;
  runtime.boundaryRecoverySince = null;
  root.querySelector<HTMLElement>("[data-webgaze-boundary-guide]")!.hidden = true;
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  const corner = boundaryPath()[runtime.boundaryCornerIndex];
  target.hidden = false;
  target.style.left = `${corner.x}px`;
  target.style.top = `${corner.y}px`;
  target.style.pointerEvents = "auto";
  target.textContent = `0/${boundaryCornerClicksRequired}`;
  target.setAttribute(
    "aria-label",
    `Boundary corner ${runtime.boundaryCornerIndex + 1}, click 1 of ${boundaryCornerClicksRequired}`,
  );
  target.onclick = null;
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  progress.hidden = false;
  progress.querySelector<HTMLElement>("b")!.style.width =
    `${(runtime.boundaryCornerIndex / 4) * 100}%`;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent =
    `Boundary corner ${runtime.boundaryCornerIndex + 1} of 5 · click 0 of 2`;
}

function recordBoundaryCorner(root: HTMLDivElement, event: MouseEvent) {
  if (runtime.calibrationStage !== "boundary" || runtime.boundaryMode !== "corner") return;
  const corner = boundaryPath()[runtime.boundaryCornerIndex];
  if (Math.hypot(event.clientX - corner.x, event.clientY - corner.y) > boundaryCornerRadiusPx)
    return;
  if (!faceFrame.inBounds) return;
  if (featureWindow.length < 3 || motion(featureWindow) >= 0.08) return;
  if (!addCalibrationSample(normalizePixelPoint(corner), 2)) return;
  runtime.boundaryCornerClicks += 1;
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  target.textContent = `${runtime.boundaryCornerClicks}/${boundaryCornerClicksRequired}`;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent =
    `Boundary corner ${runtime.boundaryCornerIndex + 1} of 5 · click ${runtime.boundaryCornerClicks} of 2`;
  if (runtime.boundaryCornerClicks < boundaryCornerClicksRequired) return;
  if (runtime.boundaryCornerIndex === 4) {
    cleanupBoundaryCalibration();
    showAccuracyCheckIntro(root);
    return;
  }
  startBoundaryTrace(root);
}

function onBoundaryClick(event: MouseEvent) {
  if (!runtime.boundaryRoot) return;
  if (runtime.boundaryMode === "trace") {
    setCalibrationStatus(
      runtime.boundaryRoot,
      "Follow the dashed edge slowly with your cursor. The corner becomes clickable after you reach it.",
    );
    return;
  }
  recordBoundaryCorner(runtime.boundaryRoot, event);
}

function startBoundaryTrace(root: HTMLDivElement) {
  runtime.boundaryMode = "trace";
  runtime.boundaryAnchorRecorded = false;
  runtime.boundaryNeedsRecovery = false;
  runtime.boundaryRecoverySince = null;
  runtime.boundaryLastPassiveAt = 0;
  runtime.boundaryLastPointer = null;
  const path = boundaryPath();
  const start = path[runtime.boundaryCornerIndex];
  const end = path[runtime.boundaryCornerIndex + 1];
  positionBoundaryGuide(root, start, end);
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  target.style.left = `${end.x}px`;
  target.style.top = `${end.y}px`;
  target.style.pointerEvents = "none";
  target.style.setProperty("--webgaze-accuracy-progress", "0%");
  target.textContent = "";
  target.onclick = null;
  setCalibrationStatus(
    root,
    "Move slowly along the dashed edge toward the next corner — do not click yet.",
  );
  root.querySelector("[data-webgaze-progress-copy]")!.textContent =
    `Trace edge ${runtime.boundaryCornerIndex + 1} of 4`;
}

function recordBoundaryTraceSample(point: PixelPoint, weight = 1) {
  if (!faceFrame.inBounds || !latestFeature || featureWindow.length < 2) return false;
  return addCalibrationSample(normalizePixelPoint(point), weight);
}

function processBoundaryPointer(
  root: HTMLDivElement,
  point: PixelPoint,
  now: number,
  speed: number,
) {
  if (runtime.calibrationStage !== "boundary" || runtime.boundaryMode !== "trace") return;
  const path = boundaryPath();
  const observation = observeSegment(
    path[runtime.boundaryCornerIndex],
    path[runtime.boundaryCornerIndex + 1],
    point,
  );
  const onRail =
    observation.distance <= boundaryRailTolerancePx &&
    observation.progress >= -0.03 &&
    observation.progress <= 1.05;
  const slowEnough = speed <= boundaryMaxSpeedPxMs;

  if (!onRail) {
    runtime.boundaryRecoverySince = null;
    return;
  }
  if (!slowEnough) {
    runtime.boundaryRecoverySince = null;
    if (observation.progress >= 0.75) {
      runtime.boundaryNeedsRecovery = true;
    }
    return;
  }

  if (
    now - runtime.boundaryLastPassiveAt >= boundaryPassiveIntervalMs &&
    recordBoundaryTraceSample(point)
  )
    runtime.boundaryLastPassiveAt = now;
  if (
    !runtime.boundaryAnchorRecorded &&
    observation.progress >= 0.45 &&
    observation.progress <= 0.75
  ) {
    if (!runtime.boundaryNeedsRecovery) {
      runtime.boundaryAnchorRecorded = recordBoundaryTraceSample(point, 3);
    } else {
      runtime.boundaryRecoverySince ??= now;
      if (now - runtime.boundaryRecoverySince >= boundaryRecoveryHoldMs) {
        runtime.boundaryAnchorRecorded = recordBoundaryTraceSample(point, 3);
        runtime.boundaryNeedsRecovery = false;
      }
    }
  } else if (!runtime.boundaryAnchorRecorded && runtime.boundaryNeedsRecovery) {
    runtime.boundaryRecoverySince = null;
  }

  if (!hasArrived(observation, boundaryArrivalRadiusPx, boundaryRailTolerancePx)) return;
  if (!runtime.boundaryAnchorRecorded) {
    runtime.boundaryNeedsRecovery = true;
    runtime.boundaryRecoverySince = null;
    return;
  }
  runtime.boundaryCornerIndex += 1;
  showBoundaryCorner(root);
}

function onBoundaryMouseMove(event: MouseEvent) {
  if (
    !runtime.boundaryRoot ||
    runtime.calibrationStage !== "boundary" ||
    runtime.boundaryMode !== "trace"
  )
    return;
  const now = performance.now();
  const current = { x: event.clientX, y: event.clientY };
  const speed = pointerSpeed(
    runtime.boundaryLastPointer,
    current,
    runtime.boundaryLastPointer ? now - runtime.boundaryLastPointer.at : 0,
  );
  runtime.boundaryLastPointer = { ...current, at: now, speed };
  processBoundaryPointer(runtime.boundaryRoot, current, now, speed);
}

function processBoundaryTimer() {
  if (
    !runtime.boundaryRoot ||
    !runtime.boundaryLastPointer ||
    runtime.boundaryMode !== "trace" ||
    !runtime.boundaryNeedsRecovery
  )
    return;
  processBoundaryPointer(runtime.boundaryRoot, runtime.boundaryLastPointer, performance.now(), 0);
}

function cleanupBoundaryCalibration() {
  runtime.boundaryRoot
    ?.querySelector<HTMLElement>("[data-webgaze-boundary-guide]")
    ?.setAttribute("hidden", "");
  window.removeEventListener("mousemove", onBoundaryMouseMove);
  window.removeEventListener("click", onBoundaryClick, true);
  if (runtime.boundaryTimer !== null) window.clearInterval(runtime.boundaryTimer);
  runtime.boundaryTimer = null;
  runtime.boundaryRoot = null;
  runtime.boundaryLastPointer = null;
  runtime.boundaryRecoverySince = null;
}

function showAccuracyCheckIntro(root: HTMLDivElement) {
  showCalibrationModal(root, {
    stage: "accuracy-intro",
    phase: "Step 3 of 3",
    title: "Step 3 of 3: Accuracy check",
    status:
      "Do not move your mouse. Look at the center dot for 5 seconds while the ring completes. Natural blinking is okay.",
    primary: "OK",
    onPrimary: () => startAccuracyCheck(root),
  });
}

function startAccuracyCheck(root: HTMLDivElement) {
  cleanupBoundaryCalibration();
  cleanupAccuracyCheck();
  const next = fitGazeModel(runtime.calibrationSamples);
  if (!next) {
    retryCalibration(root);
    setCalibrationStatus(root, "Calibration did not fit. Please try again.");
    return;
  }
  model = next;
  runtime.calibrationStage = "accuracy";
  runtime.accuracyStartedAt = performance.now();
  runtime.accuracyPredictions = [];
  root.dataset.mode = "calibration";
  root.dataset.calibrationStep = "accuracy";
  root.querySelector("[data-webgaze-phase]")!.textContent = "Step 3 of 3";
  root.querySelector("[data-webgaze-title]")!.textContent = "Accuracy check";
  setCalibrationStatus(root, "Keep your eyes on the center dot until the measurement finishes.");
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  target.hidden = false;
  target.style.left = "50%";
  target.style.top = "50%";
  target.style.pointerEvents = "none";
  target.textContent = "";
  target.onclick = null;
  root.querySelector<HTMLButtonElement>("[data-webgaze-calibrate]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-webgaze-progress]")!.hidden = false;
  root.querySelector("[data-webgaze-progress-copy]")!.textContent =
    "Center gaze hold · 0.0 / 5.0 seconds";
  root.querySelector<HTMLElement>("[data-webgaze-progress] b")!.style.width = "0%";
  runtime.accuracyTimer = window.setInterval(() => updateAccuracyCheck(root), accuracyTickMs);
}

function recordCalibration(root: HTMLDivElement) {
  const averaged = meanPoint(featureWindow);
  if (!faceFrame.inBounds) {
    setCalibrationStatus(root, "Move your face inside the boundary before recording this sample.");
    return;
  }
  if (!averaged || featureWindow.length < 3 || motion(featureWindow) >= 0.08) {
    setCalibrationStatus(root, "Keep your face visible and steady, then click this point again.");
    return;
  }
  const target = targets[runtime.calibrationIndex];
  runtime.calibrationSamples = [...runtime.calibrationSamples, { feature: averaged, target }];
  runtime.calibrationRepeat += 1;
  if (runtime.calibrationRepeat < samplesPerTarget) {
    setCalibrationStatus(
      root,
      `Sample ${runtime.calibrationRepeat} of ${samplesPerTarget} saved. Keep looking at this dot.`,
    );
    showPointTarget(root);
    return;
  }
  runtime.calibrationRepeat = 0;
  if (runtime.calibrationIndex < targets.length - 1) {
    runtime.calibrationIndex += 1;
    setCalibrationStatus(root, "Next point. Center your gaze on the green dot.");
    showPointTarget(root);
    return;
  }
  showBoundaryCalibrationIntro(root);
}

function completeCalibration(root: HTMLDivElement) {
  if (!model || runtime.calibrationStage === "submitting" || runtime.calibrationStage === "result")
    return;
  cleanupAccuracyCheck();
  const summary = summarizeAccuracy(
    runtime.accuracyPredictions,
    innerWidth,
    innerHeight,
    accuracySampleLimit,
  );
  const rms = summary.validationErrorPx / Math.hypot(innerWidth, innerHeight);
  showCalibrationModal(root, {
    stage: "result",
    phase: "Accuracy result",
    title: `Your accuracy measure is ${summary.accuracyPercent.toFixed(0)}%`,
    status: `Measurement complete • validation error ${Math.round(summary.validationErrorPx)} px`,
    primary: "OK",
    onPrimary: () => void submitCalibration(root, rms, summary.sampleCount),
    secondary: "Recalibrate",
    onSecondary: () => retryCalibration(root),
  });
}

async function submitCalibration(root: HTMLDivElement, rms: number, observedSampleCount: number) {
  if (!model || runtime.calibrationStage === "submitting") return;
  runtime.calibrationStage = "submitting";
  const primary = root.querySelector<HTMLButtonElement>("[data-webgaze-begin]")!;
  const secondary = root.querySelector<HTMLButtonElement>("[data-webgaze-secondary]")!;
  primary.disabled = true;
  secondary.disabled = true;
  root.querySelector<HTMLElement>("[data-webgaze-status]")!.textContent =
    "Saving calibration quality…";
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({
        type: "CALIBRATION_COMPLETED",
        calibration: {
          attempt: 1,
          startedAt: runtime.calibrationStartedAt ?? new Date().toISOString(),
          completedAt: new Date().toISOString(),
          observedSampleCount,
          errorPx: rms * Math.hypot(innerWidth, innerHeight),
          qualityGrade: rms <= 0.08 ? "strong" : "variable",
          rms,
        },
      }),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("The study API did not respond in time")), 15_000),
      ),
    ]);
    if (!response?.ok)
      throw new Error(response?.error ?? "The study API did not accept the calibration");
    root.querySelector("[data-webgaze-phase]")!.textContent = response?.accepted
      ? "Ready"
      : "Calibration";
    root.dataset.mode = response?.accepted ? "ready" : "calibration-intro";
    root.querySelector("[data-webgaze-status]")!.textContent = response?.accepted
      ? `Calibration accepted · ${(rms * 100).toFixed(1)}% RMS. Return to the extension to start Task 1.`
      : "Calibration was not accepted. Recalibrate and try again.";
    if (response?.accepted) {
      await chrome.storage.local.set({
        webgazeCalibration: { model, rms, savedAt: new Date().toISOString() },
      });
      primary.hidden = true;
      secondary.hidden = true;
    } else {
      runtime.calibrationStage = "result";
      primary.disabled = false;
      secondary.disabled = false;
    }
  } catch (error) {
    runtime.calibrationStage = "result";
    primary.disabled = false;
    secondary.disabled = false;
    const message = error instanceof Error ? error.message : "Unknown save error";
    root.querySelector("[data-webgaze-status]")!.textContent =
      `Could not save calibration: ${message}. Try OK again or recalibrate.`;
  }
}

async function startCamera(root: HTMLDivElement) {
  cameraCanvas(root);
}

function updateAccuracyCheck(root: HTMLDivElement) {
  if (runtime.calibrationStage !== "accuracy" || runtime.accuracyStartedAt === null) return;
  const elapsed = Math.min(performance.now() - runtime.accuracyStartedAt, accuracyDurationMs);
  const progress = root.querySelector<HTMLElement>("[data-webgaze-progress]")!;
  setCalibrationStatus(root, "Keep your eyes on the center dot until the measurement finishes.");
  root.querySelector("[data-webgaze-progress-copy]")!.textContent =
    `Center gaze · ${(elapsed / 1000).toFixed(1)} / 5.0 seconds`;
  progress.querySelector<HTMLElement>("b")!.style.width =
    `${Math.min(100, (elapsed / accuracyDurationMs) * 100)}%`;
  root
    .querySelector<HTMLElement>("[data-webgaze-target]")!
    .style.setProperty(
      "--webgaze-accuracy-progress",
      `${Math.min(100, (elapsed / accuracyDurationMs) * 100)}%`,
    );
  if (elapsed >= accuracyDurationMs) completeCalibration(root);
}

function cleanupAccuracyCheck() {
  if (runtime.accuracyTimer !== null) window.clearInterval(runtime.accuracyTimer);
  runtime.accuracyTimer = null;
  runtime.accuracyStartedAt = null;
}

function processFeature(root: HTMLDivElement, value: Point | null, frameData?: FaceFrame) {
  if (!enabled) return;
  faceFrame = frameData ?? {
    detected: Boolean(value),
    centered: Boolean(value),
    inBounds: Boolean(value),
    size: 0,
  };
  latestFeature = value;
  if (latestFeature)
    featureWindow = [...featureWindow.slice(-(checkWindowSize - 1)), latestFeature];
  else featureWindow = [];
  if (runtime.calibrationStage === "camera") updateCameraCheck(root);
  const predicted = latestFeature && model ? predictGaze(model, latestFeature) : null;
  if (runtime.calibrationStage === "accuracy" && predicted)
    runtime.accuracyPredictions = [
      ...runtime.accuracyPredictions.slice(-(accuracySampleLimit - 1)),
      predicted,
    ];
  if (predicted) {
    const x = clampCoordinate(predicted[0]);
    const y = clampCoordinate(predicted[1]);
    const point = root.querySelector<HTMLElement>("[data-webgaze-dot]")!;
    point.style.left = `${x * 100}%`;
    point.style.top = `${y * 100}%`;
    const now = performance.now();
    if (collecting && now - lastSampleAt >= sampleIntervalMs) {
      lastSampleAt = now;
      samples.push({
        x,
        y,
        at: new Date().toISOString(),
        url: location.href,
        viewport: { width: innerWidth, height: innerHeight },
        scroll: { x: scrollX, y: scrollY },
      });
      const heat = document.createElement("i");
      heat.className = "webgaze-heat-point";
      heat.style.left = `${x * 100}%`;
      heat.style.top = `${y * 100}%`;
      root.querySelector("[data-webgaze-heat]")!.append(heat);
      heatPoints.push(heat);
      if (heatPoints.length > 48) heatPoints.shift()?.remove();
      if (samples.length >= 10) void flushSamples();
    }
  }
}

function retryCalibration(root: HTMLDivElement) {
  cleanupBoundaryCalibration();
  runtime.calibrationStage = "points";
  model = null;
  collecting = false;
  runtime.calibrationIndex = 0;
  runtime.calibrationRepeat = 0;
  runtime.calibrationSamples = [];
  runtime.calibrationStartedAt = new Date().toISOString();
  cleanupAccuracyCheck();
  runtime.accuracyPredictions = [];
  root.dataset.mode = "calibration";
  root.dataset.calibrationStep = "points";
  root.querySelector("[data-webgaze-phase]")!.textContent = "Calibration";
  root.querySelector("[data-webgaze-title]")!.textContent = "Point calibration";
  setCalibrationStatus(
    root,
    `Calibration needs another attempt. Click each point ${samplesPerTarget} times.`,
  );
  showPointTarget(root);
}
function stop() {
  cleanupBoundaryCalibration();
  cleanupAccuracyCheck();
  enabled = false;
  cameraReady = false;
  collecting = false;
  model = null;
  runtime.calibrationIndex = 0;
  runtime.calibrationRepeat = 0;
  runtime.calibrationSamples = [];
  lastSampleAt = 0;
  document.querySelector("#webgaze-collector-overlay")?.remove();
  if (samples.length) void flushSamples();
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "COLLECTOR_ARM") overlay();
  if (message.type === "COLLECTOR_START_TASK") {
    collecting = true;
    const requestedInterval = Number(message.sampleIntervalMs);
    sampleIntervalMs = Number.isFinite(requestedInterval)
      ? Math.min(1000, Math.max(25, requestedInterval))
      : defaultSampleIntervalMs;
    lastSampleAt = 0;
    while (heatPoints.length) heatPoints.pop()?.remove();
    const root = overlay();
    root.dataset.mode = "task";
    root.querySelector("[data-webgaze-phase]")!.textContent = "Collecting";
    root.querySelector("[data-webgaze-status]")!.textContent =
      `Collecting coordinate estimates for ${message.taskTitle ?? "current task"}.`;
  }
  if (message.type === "COLLECTOR_DRAIN_SAMPLES") {
    collecting = false;
    void sampleFlush.then(() => {
      const drained = samples;
      samples = [];
      const root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay");
      if (root) {
        root.querySelector("[data-webgaze-phase]")!.textContent = "Ready";
        root.querySelector("[data-webgaze-status]")!.textContent =
          "Task saved. Return to the extension for the next task.";
      }
      respond({ samples: drained });
    });
    return true;
  }
  if (message.type === "COLLECTOR_INGEST_SAMPLES") {
    const incoming = Array.isArray(message.samples) ? message.samples : [];
    void chrome.runtime
      .sendMessage({ type: "GAZE_SAMPLES", samples: incoming })
      .then(respond)
      .catch((error) =>
        respond({ ok: false, error: error instanceof Error ? error.message : "Ingestion failed" }),
      );
    return true;
  }
  if (message.type === "COLLECTOR_PAGE_CONTEXT") {
    respond({
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
    });
    return;
  }
  if (message.type === "COLLECTOR_RETRY_CALIBRATION") retryCalibration(overlay());
  if (message.type === "COLLECTOR_STOP") stop();
});

document.addEventListener("visibilitychange", () => {
  if (!collecting) return;
  const root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay");
  if (!root) return;
  root.querySelector<HTMLElement>("[data-webgaze-status]")!.textContent = document.hidden
    ? "Collection is paused by the browser while this task tab is in the background. Return to this tab to continue."
    : "Task tab active. Collecting coordinate estimates.";
});

window.addEventListener("message", (event) => {
  const root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay");
  const canvas = root?.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]");
  const message = event.data;
  if (
    !root ||
    !canvas ||
    event.source !== canvas.contentWindow ||
    message?.source !== "webgaze-camera-runtime"
  )
    return;
  if (message.type === "CAMERA_READY") {
    cameraReady = true;
    enabled = true;
    // Runtime readiness may be reported again after an iframe lifecycle event.
    // It is a health signal, never permission to reset an in-progress study.
    if (runtime.calibrationStage === "camera") featureWindow = [];
    return;
  }
  if (message.type === "CAMERA_FEATURE")
    processFeature(root, message.feature ?? null, message.face);
  if (message.type === "CAMERA_BEGIN_CALIBRATION") void showCalibrationSetup(root);
  if (message.type === "CAMERA_STOPPED") {
    enabled = false;
    cameraReady = false;
    runtime.calibrationStage = "camera";
    root.querySelector<HTMLIFrameElement>("[data-webgaze-camera-canvas]")?.remove();
    root.dataset.mode = "camera";
    cameraCanvas(root);
  }
});
