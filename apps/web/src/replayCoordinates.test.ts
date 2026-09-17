import { describe, expect, it } from "vitest";

import { parseCollectorArtifact } from "./collectorArtifact";
import {
  detectScrollSegments,
  inferDocumentExtent,
  insertReplaySnapshot,
  projectReplaySample,
} from "./replayCoordinates";

const artifact = parseCollectorArtifact({
  schemaVersion: "1.0",
  sessionId: "session",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:00:10.000Z",
  captureSnapshots: true,
  events: [],
  snapshots: [
    {
      at: "2026-01-01T00:00:00.000Z",
      dataUrl: "data:image/png;base64,x",
      viewport: { width: 1000, height: 500 },
      scroll: { x: 0, y: 0 },
    },
  ],
  gazeSamples: [
    { x: 0.5, y: 0.5, viewport: { width: 1000, height: 500 }, scroll: { x: 0, y: 0 } },
    { x: 0.5, y: 0.5, viewport: { width: 1000, height: 500 }, scroll: { x: 0, y: 500 } },
  ],
  privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: true },
});

describe("replay coordinate tools", () => {
  it("detects stable scroll segments", () => {
    const segments = detectScrollSegments(artifact.gazeSamples ?? []);
    expect(segments).toHaveLength(2);
    expect(segments[1].label).toContain("y 500");
  });

  it("projects viewport gaze into inferred document coordinates", () => {
    const extent = inferDocumentExtent(artifact);
    expect(extent).toEqual({ width: 1000, height: 1000 });
    expect(projectReplaySample(artifact.gazeSamples![1], "document", extent)).toMatchObject({
      x: 0.5,
      y: 0.75,
    });
  });

  it("inserts and orders a researcher screenshot at the playhead", () => {
    const next = insertReplaySnapshot(artifact, "data:image/png;base64,new", 5_000);
    expect(next.snapshots).toHaveLength(2);
    expect(next.snapshots[1]).toMatchObject({
      reason: "researcher-inserted",
      viewport: { width: 1000, height: 500 },
    });
  });
});
