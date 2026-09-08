import { describe, expect, it } from "vitest";

import {
  enqueueBatch,
  flushPendingBatches,
  pendingBatches,
} from "./collection";
import type { GazeBatchCreate } from "./api";

function batch(sequence: number): GazeBatchCreate {
  return {
    client_batch_id: `00000000-0000-4000-8000-00000000000${sequence}`,
    sequence,
    schema_version: "1.0",
    captured_from: "2026-09-07T00:00:00Z",
    captured_to: "2026-09-07T00:00:00Z",
    samples: [{
      timestamp: "2026-09-07T00:00:00Z",
      x_normalized: 0.2,
      y_normalized: 0.8,
      confidence: 0.9,
      scroll_x: 0,
      scroll_y: 0,
      viewport_width: 1280,
      viewport_height: 720,
    }],
  };
}

describe("gaze batch queue", () => {
  it("retries from the failed batch without duplicating acknowledged work", async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    };
    const sessionId = "session-1";
    enqueueBatch(storage, sessionId, batch(0));
    enqueueBatch(storage, sessionId, batch(1));
    const sent: number[] = [];

    await expect(
      flushPendingBatches(storage, sessionId, async (item) => {
        sent.push(item.sequence);
        if (item.sequence === 1) throw new Error("offline");
      }),
    ).rejects.toThrow("offline");

    expect(sent).toEqual([0, 1]);
    expect(pendingBatches(storage, sessionId).map((item) => item.sequence)).toEqual([1]);

    await flushPendingBatches(storage, sessionId, async (item) => {
      sent.push(item.sequence);
    });
    expect(sent).toEqual([0, 1, 1]);
    expect(pendingBatches(storage, sessionId)).toEqual([]);
  });
});
