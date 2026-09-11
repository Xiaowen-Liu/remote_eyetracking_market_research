import { describe, expect, it } from "vitest";

import { parseCollectorArtifact } from "./collectorArtifact";

describe("parseCollectorArtifact", () => {
  const artifact = {
    schemaVersion: "1.0",
    sessionId: "collector-session",
    startedAt: "2026-09-11T00:00:00.000Z",
    endedAt: "2026-09-11T00:01:00.000Z",
    captureSnapshots: true,
    events: [{ type: "page-open", url: "https://example.com", at: "2026-09-11T00:00:00.000Z" }],
    snapshots: [{ at: "2026-09-11T00:00:05.000Z", dataUrl: "data:image/jpeg;base64,abc" }],
    gazeSamples: [{ x: 0.4, y: 0.6, confidence: 0.8 }],
    privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: true },
  };

  it("accepts a privacy-preserving collector export", () => {
    expect(parseCollectorArtifact(artifact)).toMatchObject({ sessionId: "collector-session", gazeSamples: [{ x: 0.4, y: 0.6 }] });
  });

  it("rejects an artifact that claims to include raw camera video", () => {
    expect(() => parseCollectorArtifact({ ...artifact, privacy: { ...artifact.privacy, rawCameraVideo: true } })).toThrow("privacy contract");
  });
});
