import { describe, expect, it } from "vitest";
import { aggregateAoiMetrics, assignSampleToAoi, calculateAoiMetrics } from "./aoiMetrics";

describe("calculateAoiMetrics", () => {
  it("derives visits, dwell, latency, and revisits from raw samples", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const at = (ms: number) => new Date(Date.parse(startedAt) + ms).toISOString();
    const samples = [0, 200, 400, 1200, 1400, 1600].map((ms) => ({
      x: 0.25,
      y: 0.25,
      at: at(ms),
    }));
    const [metric] = calculateAoiMetrics(
      [{ id: "a", label: "Hero", x: 0.1, y: 0.1, width: 0.3, height: 0.3 }],
      samples,
      startedAt,
    );
    expect(metric.sampleCount).toBe(6);
    expect(metric.visits).toHaveLength(2);
    expect(metric.revisitCount).toBe(1);
    expect(metric.ttffMs).toBe(0);
    expect(metric.firstMeaningfulDurationMs).toBe(500);
    expect(metric.fixationCount).toBe(2);
  });

  it("prefers a valid recorded AOI id, then exact and tolerant spatial hits", () => {
    const aois = [
      { id: "large", label: "Large", x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
      { id: "small", label: "Small", x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
    ];
    expect(assignSampleToAoi(aois, { x: 0.9, y: 0.9, aoiId: "small" })).toBe("small");
    expect(assignSampleToAoi(aois, { x: 0.25, y: 0.25 })).toBe("small");
    expect(
      assignSampleToAoi(aois, {
        x: 0.505,
        y: 0.25,
        viewport: { width: 1000, height: 800 },
      }),
    ).toBe("large");
  });

  it("returns explicit empty metrics for an AOI without gaze", () => {
    const [metric] = calculateAoiMetrics(
      [{ id: "a", label: "Footer", x: 0.8, y: 0.8, width: 0.1, height: 0.1 }],
      [{ x: 0.1, y: 0.1 }],
      "2026-01-01T00:00:00.000Z",
    );
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
      [{ id: "a", label: "Hero", x: 0, y: 0, width: 0.5, height: 0.5 }],
      [
        {
          sessionId: "noticed",
          startedAt,
          samples: [0, 100, 200].map((ms) => ({ x: 0.2, y: 0.2, at: at(ms) })),
        },
        { sessionId: "missed", startedAt, samples: [{ x: 0.8, y: 0.8, at: at(0) }] },
        { sessionId: "excluded", startedAt, samples: [{ x: 0.2, y: 0.2, at: at(0) }] },
      ],
      (_, sessionId) => sessionId !== "excluded",
    );
    expect(aggregate.applicableSessions).toBe(2);
    expect(aggregate.noticedSessions).toBe(1);
    expect(aggregate.exposureRate).toBe(0.5);
    expect(aggregate.averageDwellMs).toBe(300);
    expect(aggregate.medianTtffMs).toBe(0);
  });
});
