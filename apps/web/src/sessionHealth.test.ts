import { describe, expect, it } from "vitest";

import type { CollectorArtifact } from "./collectorArtifact";
import { collectorSessionHealth } from "./sessionHealth";

function artifact(overrides: Partial<CollectorArtifact> = {}): CollectorArtifact {
  return {
    schemaVersion: "1.0",
    sessionId: "session-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
    captureSnapshots: false,
    events: [],
    snapshots: [],
    gazeSamples: Array.from({ length: 80 }, (_, index) => ({ x: .5, y: .5, confidence: .88, at: `2026-01-01T00:00:0${Math.min(9, Math.floor(index / 8))}.000Z` })),
    calibration: { attempt: 1, observed_sample_count: 35, error_px: 42, quality_grade: "strong", accepted: true },
    privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: false },
    ...overrides,
  };
}

describe("collectorSessionHealth", () => {
  it("marks a completed, calibrated, well-sampled session good", () => {
    const health = collectorSessionHealth(artifact());
    expect(health.grade).toBe("good");
    expect(health.sampleRateHz).toBe(8);
    expect(health.meanConfidence).toBeCloseTo(.88);
  });

  it("does not present sparse or incomplete collection as valid evidence", () => {
    expect(collectorSessionHealth(artifact({ endedAt: undefined })).grade).toBe("invalid");
    expect(collectorSessionHealth(artifact({ gazeSamples: [{ x: .5, y: .5 }] })).grade).toBe("invalid");
  });

  it("labels variable calibration as directional even with dense samples", () => {
    const health = collectorSessionHealth(artifact({ calibration: { attempt: 1, observed_sample_count: 35, error_px: 120, quality_grade: "variable", accepted: true } }));
    expect(health.grade).toBe("directional");
    expect(health.explanation).toContain("variable calibration");
  });
});
