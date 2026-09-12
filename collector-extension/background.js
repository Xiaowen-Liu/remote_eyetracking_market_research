import { addEvent, addSnapshot, exportArtifact, newSession } from "./core/session-artifact.js";
import { apiUrl, calibrationPayload, defaultApiBase, gazeBatch, nextBatchSequence, participantToken } from "./core/study-session.js";

const key = "webgaze.experimental.collector.session";
const read = async () => (await chrome.storage.session.get(key))[key] ?? null;
const write = (session) => chrome.storage.session.set({ [key]: session });
let operations = Promise.resolve();
let cameraTabId = null;

async function ensureCameraRuntime() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (!contexts.length) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "Run consented, on-device webcam gaze estimation for the active study participant." });
}
async function startCamera(tabId) {
  cameraTabId = tabId;
  await ensureCameraRuntime();
  const result = await chrome.runtime.sendMessage({ type: "OFFSCREEN_START_CAMERA" });
  if (!result?.ok) throw new Error(result?.error ?? "Extension camera runtime could not start");
  return result;
}

async function request(session, path, init = {}) {
  const response = await fetch(apiUrl(session.apiBase, path), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body;
}
async function participantRequest(session, path, init = {}) { return request(session, path, { ...init, headers: { Authorization: `Bearer ${session.accessToken}`, ...init.headers } }); }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error("Open the study target page before continuing"); return tab; }
async function navigateAndMessage(tabId, url, message) {
  const listener = (updatedId, change) => { if (updatedId !== tabId || change.status !== "complete") return; chrome.tabs.onUpdated.removeListener(listener); void chrome.tabs.sendMessage(tabId, message).catch(() => undefined); };
  chrome.tabs.onUpdated.addListener(listener);
  await chrome.tabs.update(tabId, { url });
}
function studyState(session) { const completed = session?.completedTasks ?? 0; const next = session?.protocol?.tasks?.[completed] ?? null; return { connected: Boolean(session?.protocol), phase: session?.phase ?? "idle", title: session?.protocol?.title ?? null, consentText: session?.protocol?.consent_text ?? null, tasks: session?.protocol?.tasks?.map(({ position, title }) => ({ position, title })) ?? [], nextTask: next ? { position: next.position, title: next.title, prompt: next.prompt } : null, completedTasks: completed, calibration: session?.calibration ?? null, error: session?.lastError ?? null }; }
async function enqueueSamples(session, samples) {
  if (!session.taskRun || !samples.length) return session;
  const batch = gazeBatch(samples, nextBatchSequence(session.nextSequence ?? 0, session.pendingBatches ?? []), crypto.randomUUID());
  session.pendingBatches = [...(session.pendingBatches ?? []), batch]; await write(session);
  for (const pending of [...session.pendingBatches]) { await participantRequest(session, `/participant-sessions/${session.sessionId}/gaze-batches`, { method: "POST", body: JSON.stringify(pending) }); session.pendingBatches = session.pendingBatches.filter((item) => item.client_batch_id !== pending.client_batch_id); session.nextSequence = Math.max(session.nextSequence ?? 0, pending.sequence + 1); await write(session); }
  return session;
}
async function startStudy(session) {
  const tab = await activeTab(), protocol = session.protocol;
  const access = await request(session, `/participate/${session.participantToken}/sessions`, { method: "POST", body: JSON.stringify({ browser_family: "Chromium extension", viewport_width: tab.width ?? 1280, viewport_height: tab.height ?? 720, device_pixel_ratio: 1 }) });
  await participantRequest({ ...session, accessToken: access.access_token }, `/participant-sessions/${access.id}/consent`, { method: "POST", body: JSON.stringify({ accepted: true, consent_version: protocol.consent_version }) });
  const next = { ...session, ...newSession({ sessionId: crypto.randomUUID(), captureSnapshots: session.captureSnapshots }), sessionId: access.id, accessToken: access.access_token, phase: "calibrating", completedTasks: 0, nextSequence: 0, pendingBatches: [], lastError: null };
  await write(next); await navigateAndMessage(tab.id, protocol.tasks[0].start_url, { type: "COLLECTOR_ARM" }); return next;
}
async function startTask(session) {
  const task = session.protocol.tasks[session.completedTasks]; if (!task) throw new Error("Every task is already complete");
  const run = await participantRequest(session, `/participant-sessions/${session.sessionId}/task-runs`, { method: "POST", body: JSON.stringify({ task_position: task.position }) });
  const tab = await activeTab(), next = { ...session, taskRun: run, phase: "running", lastError: null }; await write(next);
  if (tab.url !== task.start_url) await navigateAndMessage(tab.id, task.start_url, { type: "COLLECTOR_START_TASK", taskTitle: task.title }); else await chrome.tabs.sendMessage(tab.id, { type: "COLLECTOR_START_TASK", taskTitle: task.title }); return next;
}
async function finishTask(session) {
  if (!session.taskRun) throw new Error("No task is running");
  const tab = await activeTab(), drained = await chrome.tabs.sendMessage(tab.id, { type: "COLLECTOR_DRAIN_SAMPLES" }).catch(() => ({ samples: [] }));
  let next = { ...session, gazeSamples: [...(session.gazeSamples ?? []), ...(drained.samples ?? [])] }; await write(next); next = await enqueueSamples(next, drained.samples ?? []);
  await participantRequest(next, `/participant-sessions/${next.sessionId}/task-runs/${next.taskRun.id}/complete`, { method: "POST", body: JSON.stringify({ outcome: "completed" }) });
  next = { ...next, taskRun: null, completedTasks: next.completedTasks + 1, phase: "ready", lastError: null }; await write(next); return next;
}
async function submitStudy(session) { if (session.taskRun || session.completedTasks !== session.protocol.tasks.length) throw new Error("Complete every task before submitting"); const submitted = await participantRequest(session, `/participant-sessions/${session.sessionId}/submit`, { method: "POST" }); const next = { ...session, phase: "submitted", submitted, lastError: null }; await write(next); return next; }

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "OFFSCREEN_CAMERA_FEATURE") {
    if (cameraTabId) void chrome.tabs.sendMessage(cameraTabId, { type: "CAMERA_FEATURE", feature: message.feature, at: message.at, video: message.video }).catch(() => undefined);
    return;
  }
  if (message.type === "OFFSCREEN_START_CAMERA" || message.type === "OFFSCREEN_STOP_CAMERA") return;
  operations = operations.then(async () => {
    let session = await read();
    if (message.type === "STUDY_STATUS") { respond({ ok: true, state: studyState(session) }); return; }
    if (message.type === "CONNECT_STUDY") { const token = participantToken(message.participantLink ?? ""); if (!token) throw new Error("Paste a valid participant link or capability token"); const apiBase = message.apiBase?.trim() || defaultApiBase; const protocol = await request({ apiBase }, `/participate/${token}`); if (!protocol.collection_policy?.webcam_gaze_enabled) throw new Error("This study has not enabled experimental webcam gaze collection"); session = { ...newSession({ sessionId: crypto.randomUUID(), captureSnapshots: Boolean(message.captureSnapshots) }), apiBase, participantToken: token, protocol, phase: "consent", completedTasks: 0, pendingBatches: [], nextSequence: 0, lastError: null }; await write(session); respond({ ok: true, state: studyState(session) }); return; }
    if (!session) throw new Error("Connect a published study first");
    if (message.type === "START_CAMERA") { if (!sender.tab?.id) throw new Error("Open the study target page before starting the camera"); await startCamera(sender.tab.id); respond({ ok: true }); return; }
    if (message.type === "ACCEPT_CONSENT") { session = await startStudy(session); respond({ ok: true, state: studyState(session) }); return; }
    if (message.type === "START_STUDY_TASK") { if (session.phase !== "ready") throw new Error("Finish accepted calibration before starting a task"); session = await startTask(session); respond({ ok: true, state: studyState(session) }); return; }
    if (message.type === "COMPLETE_STUDY_TASK") { session = await finishTask(session); respond({ ok: true, state: studyState(session) }); return; }
    if (message.type === "SUBMIT_STUDY") { session = await submitStudy(session); respond({ ok: true, state: studyState(session) }); return; }
    if (message.type === "DOWNLOAD_ARTIFACT") { respond({ ok: true, artifact: exportArtifact(session) }); return; }
    if (message.type === "GAZE_SAMPLES") { session.gazeSamples = [...(session.gazeSamples ?? []), ...message.samples]; await write(session); session = await enqueueSamples(session, message.samples); respond({ ok: true }); return; }
    if (message.type === "CALIBRATION_COMPLETED") { const calibration = { ...message.calibration, attempt: (session.calibration?.attempt ?? 0) + 1 }; const recorded = await participantRequest(session, `/participant-sessions/${session.sessionId}/calibrations`, { method: "POST", body: JSON.stringify(calibrationPayload(calibration)) }); session = { ...session, calibration: recorded, phase: recorded.accepted ? "ready" : "calibrating", lastError: null }; await write(session); if (!recorded.accepted && sender.tab?.id) await chrome.tabs.sendMessage(sender.tab.id, { type: "COLLECTOR_RETRY_CALIBRATION" }); respond({ ok: true, accepted: recorded.accepted, state: studyState(session) }); return; }
    if (message.type === "PAGE_EVENT") { let next = addEvent(session, message.event); if (next.captureSnapshots && ["page-open", "history-navigation", "scroll-settled"].includes(message.event.type)) { const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "jpeg", quality: 72 }); next = addSnapshot(next, { dataUrl, url: message.event.url, reason: message.event.type, viewport: message.event.detail?.viewport, scroll: message.event.detail?.scroll }); } await write(next); respond({ ok: true }); return; }
    respond({ ok: false });
  }).catch(async (error) => { const session = await read(); if (session) await write({ ...session, lastError: error instanceof Error ? error.message : "Extension operation failed" }); respond({ ok: false, error: error instanceof Error ? error.message : "Extension operation failed", state: studyState(await read()) }); });
  return true;
});
