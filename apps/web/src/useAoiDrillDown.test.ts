import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AggregateAoiMetric } from "./aoiMetrics";
import { useAoiDrillDown } from "./useAoiDrillDown";

const metrics: AggregateAoiMetric[] = [
  {
    aoi: { id: "checkout", label: "Checkout", x: 0, y: 0, width: 0.5, height: 0.5 },
    applicableSessions: 1,
    noticedSessions: 1,
    exposureRate: 1,
    averageDwellMs: 600,
    averageDwellProportion: 1,
    medianTtffMs: 100,
    medianFirstMeaningfulLatencyMs: 100,
    averageFirstMeaningfulDurationMs: 600,
    revisitRate: 0,
    sessionMetrics: [
      {
        sessionId: "session-1",
        sessionStartedAt: "2026-09-21T00:00:00.000Z",
        sessionEndedAt: "2026-09-21T00:00:01.000Z",
        aoi: { id: "checkout", label: "Checkout", x: 0, y: 0, width: 0.5, height: 0.5 },
        sampleCount: 1,
        dwellMs: 600,
        dwellProportion: 1,
        ttffMs: 100,
        firstMeaningfulLatencyMs: 100,
        firstMeaningfulDurationMs: 600,
        revisitCount: 0,
        fixationCount: 1,
        visits: [],
        samples: [{ x: 0.2, y: 0.2 }],
      },
    ],
  },
];

describe("useAoiDrillDown", () => {
  it("selects an AOI and links it to the current replay session", () => {
    const { result } = renderHook(() => useAoiDrillDown(metrics, "session-1"));
    act(() => result.current.selectAoi("checkout"));
    expect(result.current.selectedMetric?.aoi.label).toBe("Checkout");
    expect(result.current.sessionMetric?.sessionId).toBe("session-1");
    expect(result.current.samples).toHaveLength(1);
  });
});
