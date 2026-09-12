import test from "node:test";
import assert from "node:assert/strict";
import { apiUrl, calibrationPayload, gazeBatch, nextBatchSequence, participantToken } from "../collector-extension/core/study-session.js";

test("extracts a capability token only from a participant URL or token", () => {
  assert.equal(participantToken("https://webgaze-research.vercel.app/participate/abc_DEF-1234567890"), "abc_DEF-1234567890");
  assert.equal(participantToken("abc_DEF-1234567890"), "abc_DEF-1234567890");
  assert.equal(participantToken("https://example.test/nope"), null);
});

test("builds an API-compatible coordinate batch", () => {
  const batch = gazeBatch([{ x: .2, y: .6, at: "2026-09-11T16:00:00Z", viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 12 } }], 3, "batch-id");
  assert.equal(apiUrl("https://api.test/", "/participate/token"), "https://api.test/api/v1/participate/token");
  assert.equal(batch.sequence, 3);
  assert.equal(batch.captured_to, "2026-09-11T16:00:00Z");
  assert.equal(batch.samples[0].viewport_width, 1280);
});

test("reserves a later sequence while an earlier batch awaits acknowledgement", () => {
  assert.equal(nextBatchSequence(0, []), 0);
  assert.equal(nextBatchSequence(0, [{ sequence: 0 }]), 1);
  assert.equal(nextBatchSequence(3, [{ sequence: 3 }, { sequence: 4 }]), 5);
});

test("records calibration without camera frames", () => {
  const payload = calibrationPayload({ attempt: 1, startedAt: "2026-09-11T16:00:00Z", completedAt: "2026-09-11T16:00:10Z", observedSampleCount: 9, errorPx: 42, qualityGrade: "strong", rms: .04 });
  assert.equal(payload.diagnostics.camera_frames_uploaded, false);
  assert.equal(payload.quality_grade, "strong");
});
