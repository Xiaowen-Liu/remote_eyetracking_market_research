import test from "node:test";
import assert from "node:assert/strict";
import { addEvent, addSnapshot, exportArtifact, newSession } from "../collector-extension/core/session-artifact.js";

test("collector artifact excludes camera video and gates snapshots by consented policy", () => {
  const base = newSession({ sessionId: "session-1", captureSnapshots: false });
  const eventful = addEvent(base, { type: "scroll-settled", url: "https://example.test", at: "2026-01-01T00:00:00Z" });
  const withoutSnapshot = addSnapshot(eventful, { url: "https://example.test", dataUrl: "data:image/jpeg;base64,x", reason: "scroll" });
  assert.equal(withoutSnapshot.events.length, 1);
  assert.equal(withoutSnapshot.snapshots.length, 0);
  assert.deepEqual(exportArtifact(withoutSnapshot).privacy, { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: false });
});
