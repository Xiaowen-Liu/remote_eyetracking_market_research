import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

type Point = readonly [number, number];
let landmarker: FaceLandmarker | null = null;
let video: HTMLVideoElement | null = null;
let frame: number | null = null;
let enabled = false;
let samples: { x: number; y: number; at: string }[] = [];

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
  root.innerHTML = '<div data-webgaze-status>Experimental collector ready</div><button type="button" data-webgaze-enable>Enable camera locally</button><div data-webgaze-heat></div><i data-webgaze-dot></i>';
  document.documentElement.append(root);
  root.querySelector<HTMLButtonElement>("[data-webgaze-enable]")!.onclick = () => void startCamera(root!);
  return root;
}

async function startCamera(root: HTMLDivElement) {
  try {
    root.querySelector("[data-webgaze-status]")!.textContent = "Loading on-device landmark model…";
    video = document.createElement("video"); video.muted = true; video.playsInline = true;
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    await video.play();
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" }, runningMode: "VIDEO", numFaces: 1 });
    enabled = true; root.querySelector("[data-webgaze-enable]")!.remove(); root.querySelector("[data-webgaze-status]")!.textContent = "Live local estimate · frames stay in this tab"; tick(root);
  } catch (error) { root.querySelector("[data-webgaze-status]")!.textContent = error instanceof Error ? error.message : "Camera could not start"; }
}

function tick(root: HTMLDivElement) {
  if (!enabled || !video || !landmarker) return;
  const next = feature(landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] ?? []);
  if (next) {
    // Initial bridge intentionally renders relative iris motion; calibration mapping is added in the next collector slice.
    const x = Math.min(.98, Math.max(.02, .5 + next[0] * 1.8)); const y = Math.min(.98, Math.max(.02, .5 + next[1] * 1.8));
    const point = root.querySelector<HTMLElement>("[data-webgaze-dot]")!; point.style.left = `${x * 100}%`; point.style.top = `${y * 100}%`;
    const heat = document.createElement("i"); heat.className = "webgaze-heat-point"; heat.style.left = `${x * 100}%`; heat.style.top = `${y * 100}%`; root.querySelector("[data-webgaze-heat]")!.append(heat); if (root.querySelectorAll(".webgaze-heat-point").length > 90) heat.parentElement!.firstElementChild?.remove();
    samples.push({ x, y, at: new Date().toISOString() }); if (samples.length >= 10) { chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }
  }
  frame = requestAnimationFrame(() => tick(root));
}

function stop() { enabled = false; if (frame) cancelAnimationFrame(frame); video?.srcObject && (video.srcObject as MediaStream).getTracks().forEach((track) => track.stop()); document.querySelector("#webgaze-collector-overlay")?.remove(); if (samples.length) chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }); samples = []; }
chrome.runtime.onMessage.addListener((message) => { if (message.type === "COLLECTOR_ARM") overlay(); if (message.type === "COLLECTOR_STOP") stop(); });
