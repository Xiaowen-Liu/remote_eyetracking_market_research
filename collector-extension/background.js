import { addEvent, addSnapshot, exportArtifact, newSession } from "./core/session-artifact.js";

const key = "webgaze.experimental.collector.session";
const read = async () => (await chrome.storage.session.get(key))[key] ?? null;
const write = (session) => chrome.storage.session.set({ [key]: session });
let operations = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  operations = operations.then(async () => {
    const session = await read();
    if (message.type === "START_COLLECTION") { await write(newSession(message)); const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "COLLECTOR_ARM" }); respond({ ok: true }); return; }
    if (message.type === "STOP_COLLECTION") { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "COLLECTOR_STOP" }); respond({ artifact: session ? exportArtifact(session) : null }); await chrome.storage.session.remove(key); return; }
    if (!session || !sender.tab?.id) { respond({ ok: false }); return; }
    if (message.type === "GAZE_SAMPLES") { await write({ ...session, gazeSamples: [...(session.gazeSamples ?? []), ...message.samples] }); respond({ ok: true }); return; }
    if (message.type === "PAGE_EVENT") {
      let next = addEvent(session, message.event);
      if (session.captureSnapshots && ["page-open", "history-navigation", "scroll-settled"].includes(message.event.type)) {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 72 });
        next = addSnapshot(next, { dataUrl, url: message.event.url, reason: message.event.type, viewport: message.event.detail?.viewport, scroll: message.event.detail?.scroll });
      }
      await write(next); respond({ ok: true }); return;
    }
    respond({ ok: false });
  }).catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : "Collector operation failed" }));
  return true;
});
