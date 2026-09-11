import { addEvent, addSnapshot, exportArtifact, newSession } from "./core/session-artifact.js";

const key = "webgaze.experimental.collector.session";
const read = async () => (await chrome.storage.session.get(key))[key] ?? null;
const write = (session) => chrome.storage.session.set({ [key]: session });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void (async () => {
    const session = await read();
    if (message.type === "START_COLLECTION") { await write(newSession(message)); respond({ ok: true }); return; }
    if (message.type === "STOP_COLLECTION") { respond({ artifact: session ? exportArtifact(session) : null }); await chrome.storage.session.remove(key); return; }
    if (!session || !sender.tab?.id) { respond({ ok: false }); return; }
    if (message.type === "PAGE_EVENT") {
      let next = addEvent(session, message.event);
      if (session.captureSnapshots && ["page-open", "history-navigation", "scroll-settled"].includes(message.event.type)) {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 72 });
        next = addSnapshot(next, { dataUrl, url: message.event.url, reason: message.event.type });
      }
      await write(next); respond({ ok: true }); return;
    }
    respond({ ok: false });
  })();
  return true;
});
