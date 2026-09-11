import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample, type GazeModel } from "../../apps/web/src/gazeMath";

type Point = readonly [number, number];
let landmarker: FaceLandmarker | null = null;
let video: HTMLVideoElement | null = null;
let frame: number | null = null;
let enabled = false;
type CapturedSample = { x: number; y: number; at: string; url: string; viewport: { width: number; height: number }; scroll: { x: number; y: number } };
let samples: CapturedSample[] = [];
let latestFeature: Point | null = null;
let calibrationIndex = 0;
let calibrationSamples: CalibrationSample[] = [];
let model: GazeModel | null = null;
const targets: Point[] = [[.12, .14], [.5, .14], [.88, .14], [.12, .5], [.5, .5], [.88, .5], [.12, .86], [.5, .86], [.88, .86]];

function feature(landmarks: NormalizedLandmark[]): Point | null {
  const leftIris = landmarks[468], rightIris = landmarks[473], leftOuter = landmarks[33], leftInner = landmarks[133], rightOuter = landmarks[263], rightInner = landmarks[362];
  if (![leftIris, rightIris, leftOuter, leftInner, rightOuter, rightInner].every(Boolean)) return null;
  const leftWidth = Math.abs(leftOuter.x - leftInner.x) || .001, rightWidth = Math.abs(rightOuter.x - rightInner.x) || .001;
  return [((leftIris.x - (leftOuter.x + leftInner.x) / 2) / leftWidth + (rightIris.x - (rightOuter.x + rightInner.x) / 2) / rightWidth) / 2, ((leftIris.y - (leftOuter.y + leftInner.y) / 2) / leftWidth + (rightIris.y - (rightOuter.y + rightInner.y) / 2) / rightWidth) / 2];
}

function overlay() {
  let root = document.querySelector<HTMLDivElement>("#webgaze-collector-overlay");
  if (root) return root;
  root = document.createElement("div"); root.id = "webgaze-collector-overlay";
  root.innerHTML = '<div data-webgaze-status>Experimental collector ready</div><button type="button" data-webgaze-enable>Enable camera locally</button><button type="button" data-webgaze-calibrate hidden>Record calibration point</button><i data-webgaze-target hidden></i><div data-webgaze-heat></div><i data-webgaze-dot></i>';
  document.documentElement.append(root);
  root.querySelector<HTMLButtonElement>("[data-webgaze-enable]")!.onclick = () => void startCamera(root!);
  return root;
}

function showTarget(root: HTMLDivElement) {
  const target = root.querySelector<HTMLElement>("[data-webgaze-target]")!;
  const button = root.querySelector<HTMLButtonElement>("[data-webgaze-calibrate]")!;
  const [x, y] = targets[calibrationIndex]; target.hidden = false; button.hidden = false;
  target.style.left = `${x * 100}%`; target.style.top = `${y * 100}%`;
  button.textContent = `Record point ${calibrationIndex + 1} of 9`;
  button.onclick = () => recordCalibration(root);
}

function recordCalibration(root: HTMLDivElement) {
  if (!latestFeature) { root.querySelector("[data-webgaze-status]")!.textContent = "Face not detected. Keep both eyes visible, then try again."; return; }
  calibrationSamples = [...calibrationSamples, { feature: latestFeature, target: targets[calibrationIndex] }];
  if (calibrationIndex < targets.length - 1) { calibrationIndex += 1; showTarget(root); return; }
  const next = fitGazeModel(calibrationSamples);
  if (!next) { calibrationIndex = 0; calibrationSamples = []; root.querySelector("[data-webgaze-status]")!.textContent = "Calibration did not fit. Try again."; showTarget(root); return; }
  const error = calibrationError(next, calibrationSamples);
  if (error > .18) { calibrationIndex = 0; calibrationSamples = []; root.querySelector("[data-webgaze-status]")!.textContent = `Calibration weak (${(error * 100).toFixed(1)}% RMS). Try again.`; showTarget(root); return; }
  model = next; root.querySelector("[data-webgaze-target]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-calibrate]")!.setAttribute("hidden", ""); root.querySelector("[data-webgaze-status]")!.textContent = `Live calibrated estimate · ${(error * 100).toFixed(1)}% RMS`;
}

async function startCamera(root: HTMLDivElement) {
  try {
    root.querySelector("[data-webgaze-status]")!.textContent = "Loading on-device landmark model…";
    video = document.createElement("video"); video.muted = true; video.playsInline = true;
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    await video.play();
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" }, runningMode: "VIDEO", numFaces: 1 });
    enabled = true; root.querySelector("[data-webgaze-enable]")!.remove(); root.querySelector("[data-webgaze-status]")!.textContent = "Look at each dot, then record it. Frames stay in this tab."; showTarget(root); tick(root);
  } catch (error) { root.querySelector("[data-webgaze-status]")!.textContent = error instanceof Error ? error.message : "Camera could not start"; }
}

function tick(root: HTMLDivElement) {
  if (!enabled || !video || !landmarker) return;
  const next = feature(landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] ?? []); latestFeature = next;
  if (next) {
    if (!model) { frame = requestAnimationFrame(() => tick(root)); return; }
    const [x, y] = predictGaze(model, next);
    const point = root.querySelector<HTMLElement>("[data-webgaze-dot]")!; point.style.left = `${x * 100}%`; point.style.top = `${y * 100}%`;
    const heat = document.createElement("i"); heat.className = "webgaze-heat-point"; heat.style.left = `${x * 100}%`; heat.style.top = `${y * 100}%`; root.querySelector("[data-webgaze-heat]")!.append(heat); if (root.querySelectorAll(".webgaze-heat-point").length > 90) heat.parentElement!.firstElementChild?.remove();
    samples.push({ x, y, at: new Date().toISOString(), url: location.href, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } }); if (samples.length >= 10) { chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }
  }
  frame = requestAnimationFrame(() => tick(root));
}

function stop() { enabled = false; model = null; calibrationIndex = 0; calibrationSamples = []; if (frame) cancelAnimationFrame(frame); video?.srcObject && (video.srcObject as MediaStream).getTracks().forEach((track) => track.stop()); document.querySelector("#webgaze-collector-overlay")?.remove(); if (samples.length) chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }
chrome.runtime.onMessage.addListener((message) => { if (message.type === "COLLECTOR_ARM") overlay(); if (message.type === "COLLECTOR_STOP") stop(); });
