import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CollectorArtifact } from "./collectorArtifact";
import { replayDuration, useReplayPlayback } from "./useReplayPlayback";

const artifact: CollectorArtifact = {
  schemaVersion: "1.0",
  sessionId: "replay-session",
  startedAt: "2026-09-21T00:00:00.000Z",
  endedAt: "2026-09-21T00:00:12.000Z",
  captureSnapshots: false,
  events: [],
  snapshots: [],
  gazeSamples: [],
  privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: false },
};

describe("useReplayPlayback", () => {
  it("derives duration from the artifact boundary", () => {
    expect(replayDuration(artifact)).toBe(12_000);
    expect(replayDuration(null)).toBe(0);
  });

  it("owns keyboard seeking without dashboard state dependencies", () => {
    const { result } = renderHook(() => useReplayPlayback(artifact, true));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" })));
    expect(result.current.timeMs).toBe(12_000);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" })));
    expect(result.current.timeMs).toBe(0);
  });
});
