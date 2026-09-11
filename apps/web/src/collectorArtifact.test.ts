import { describe, expect, it } from "vitest";

import { buildHeatmap, gazeSamplesForSnapshot, parseCollectorArtifact } from "./collectorArtifact";

describe("parseCollectorArtifact", () => {
  const artifact = {
    schemaVersion: "1.0",
    sessionId: "collector-session",
    startedAt: "2026-09-11T00:00:00.000Z",
    endedAt: "2026-09-11T00:01:00.000Z",
    captureSnapshots: true,
    events: [{ type: "page-open", url: "https://example.com", at: "2026-09-11T00:00:00.000Z" }],
    snapshots: [{ at: "2026-09-11T00:00:05.000Z", dataUrl: "data:image/jpeg;base64,abc" }],
    gazeSamples: [{ x: 0.4, y: 0.6, confidence: 0.8, at: "2026-09-11T00:00:04.000Z", url: "https://example.com" }],
    privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: true },
  };

  it("accepts a privacy-preserving collector export", () => {
    expect(parseCollectorArtifact(artifact)).toMatchObject({ sessionId: "collector-session", gazeSamples: [{ x: 0.4, y: 0.6 }] });
  });

  it("rejects an artifact that claims to include raw camera video", () => {
    expect(() => parseCollectorArtifact({ ...artifact, privacy: { ...artifact.privacy, rawCameraVideo: true } })).toThrow("privacy contract");
  });

  it("selects snapshot-context samples and aggregates heat cells", () => {
    const parsed = parseCollectorArtifact(artifact);
    const samples = gazeSamplesForSnapshot(parsed, 0);
    expect(samples).toHaveLength(1);
    expect(buildHeatmap([...samples, ...samples])).toEqual([
      expect.objectContaining({ count: 2, intensity: 1 }),
    ]);
  });

  it("drops out-of-bounds coordinates before replay", () => {
    const parsed = parseCollectorArtifact({ ...artifact, gazeSamples: [{ x: 1.4, y: 0.2 }] });
    expect(parsed.gazeSamples).toEqual([]);
  });
});
