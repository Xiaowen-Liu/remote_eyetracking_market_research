import { describe, expect, it } from "vitest";

import { gazeSamplesForSnapshot } from "./collectorArtifact";
import { syntheticCollectorReplay } from "./demoCollectorArtifact";

describe("syntheticCollectorReplay", () => {
  it("is explicitly synthetic and provides replayable gaze segments", () => {
    expect(syntheticCollectorReplay.sessionId).toBe("synthetic-replay-demo-v1");
    expect(syntheticCollectorReplay.privacy.rawCameraVideo).toBe(false);
    expect(syntheticCollectorReplay.snapshots).toHaveLength(2);
    expect(gazeSamplesForSnapshot(syntheticCollectorReplay, 0).length).toBeGreaterThan(0);
    expect(gazeSamplesForSnapshot(syntheticCollectorReplay, 1).length).toBeGreaterThan(0);
  });
});
