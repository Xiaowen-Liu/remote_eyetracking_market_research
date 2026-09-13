import { describe, expect, it } from "vitest";
import { aggregateAoiMetrics, calculateAoiMetrics } from "./aoiMetrics";

describe("calculateAoiMetrics", () => {
  it("derives visits, dwell, latency, and revisits from raw samples", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const at = (ms: number) => new Date(Date.parse(startedAt) + ms).toISOString();
    const samples = [0, 100, 200, 900, 1000].map((ms) => ({ x: .25, y: .25, at: at(ms) }));
    const [metric] = calculateAoiMetrics([{ id: "a", label: "Hero", x: .1, y: .1, width: .3, height: .3 }], samples, startedAt);
    expect(metric.sampleCount).toBe(5);
    expect(metric.visits).toHaveLength(2);
    expect(metric.revisitCount).toBe(1);
    expect(metric.ttffMs).toBe(0);
    expect(metric.firstMeaningfulDurationMs).toBe(300);
  });

  it("returns explicit empty metrics for an AOI without gaze", () => {
    const [metric] = calculateAoiMetrics([{ id: "a", label: "Footer", x: .8, y: .8, width: .1, height: .1 }], [{ x: .1, y: .1 }], "2026-01-01T00:00:00.000Z");
    expect(metric.sampleCount).toBe(0);
    expect(metric.ttffMs).toBeNull();
    expect(metric.visits).toEqual([]);
  });
});

describe("aggregateAoiMetrics", () => {
  it("aggregates exposure, central tendency, and revisits across applicable sessions", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const at = (ms: number) => new Date(Date.parse(startedAt) + ms).toISOString();
    const [aggregate] = aggregateAoiMetrics(
      [{ id: "a", label: "Hero", x: 0, y: 0, width: .5, height: .5 }],
      [
        { sessionId: "noticed", startedAt, samples: [0, 100, 200].map((ms) => ({ x: .2, y: .2, at: at(ms) })) },
        { sessionId: "missed", startedAt, samples: [{ x: .8, y: .8, at: at(0) }] },
        { sessionId: "excluded", startedAt, samples: [{ x: .2, y: .2, at: at(0) }] },
      ],
      (_, sessionId) => sessionId !== "excluded",
    );
    expect(aggregate.applicableSessions).toBe(2);
    expect(aggregate.noticedSessions).toBe(1);
    expect(aggregate.exposureRate).toBe(.5);
    expect(aggregate.averageDwellMs).toBe(300);
    expect(aggregate.medianTtffMs).toBe(0);
  });
});
