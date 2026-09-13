import test from "node:test";
import assert from "node:assert/strict";
import { addEvent, addSnapshot, exportArtifact, newSession } from "../collector-extension/core/session-artifact.js";

test("collector artifact excludes camera video and gates snapshots by consented policy", () => {
  const base = newSession({ sessionId: "session-1", captureSnapshots: false });
  const eventful = addEvent(base, { type: "scroll-settled", url: "https://example.test", at: "2026-01-01T00:00:00Z" });
  const withoutSnapshot = addSnapshot(eventful, { url: "https://example.test", dataUrl: "data:image/jpeg;base64,x", reason: "scroll", viewport: { width: 1280, height: 720 } });
  assert.equal(withoutSnapshot.events.length, 1);
  assert.equal(withoutSnapshot.snapshots.length, 0);
  assert.deepEqual(exportArtifact(withoutSnapshot).privacy, { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: false });
});

test("collector snapshots retain viewport context when the policy is enabled", () => {
  const base = newSession({ sessionId: "session-2", captureSnapshots: true });
  const captured = addSnapshot(base, { url: "https://example.test", dataUrl: "data:image/jpeg;base64,x", reason: "page-open", viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 240 } });
  assert.deepEqual(captured.snapshots[0].viewport, { width: 1280, height: 720 });
  assert.deepEqual(captured.snapshots[0].scroll, { x: 0, y: 240 });
});

test("collector export whitelists research data and excludes session credentials", () => {
  const session = {
    ...newSession({ sessionId: "session-3", captureSnapshots: false }),
    apiBase: "https://api.example.test",
    accessToken: "participant-access-secret",
    participantToken: "participant-capability-secret",
    protocol: { title: "Private protocol" },
    pendingBatches: [{ sequence: 4 }],
    lastError: "internal transport detail",
    gazeSamples: [{ x: 0.4, y: 0.6, at: "2026-01-01T00:00:01Z" }],
    calibration: {
      attempt: 1,
      observed_sample_count: 45,
      error_px: 42,
      quality_grade: "strong",
      accepted: true,
    },
  };

  const artifact = exportArtifact(session, "2026-01-01T00:00:02Z");
  assert.equal(artifact.gazeSamples.length, 1);
  assert.equal(artifact.calibration.quality_grade, "strong");
  assert.equal("apiBase" in artifact, false);
  assert.equal("accessToken" in artifact, false);
  assert.equal("participantToken" in artifact, false);
  assert.equal("protocol" in artifact, false);
  assert.equal("pendingBatches" in artifact, false);
  assert.equal("lastError" in artifact, false);
});
