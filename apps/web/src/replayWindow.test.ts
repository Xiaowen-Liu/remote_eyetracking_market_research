import { describe, expect, it } from "vitest";
import { windowReplaySamples } from "./replayWindow";

describe("large-session replay window", () => {
  it("returns small collections without allocating a replacement", () => {
    const samples = [1, 2, 3];
    expect(windowReplaySamples(samples, 4)).toBe(samples);
  });

  it("systematically samples the full timeline to a fixed render budget", () => {
    const samples = Array.from({ length: 10_001 }, (_, index) => index);
    const window = windowReplaySamples(samples, 5);
    expect(window).toEqual([0, 2_500, 5_000, 7_500, 10_000]);
  });

  it("rejects a window that cannot preserve both endpoints", () => {
    expect(() => windowReplaySamples([1, 2, 3], 1)).toThrow("at least two");
  });

  it("keeps a 100k-sample replay projection inside its interaction budget", () => {
    const samples = Array.from({ length: 100_000 }, (_, index) => ({ x: index / 100_000, y: .5 }));
    const started = performance.now();
    for (let run = 0; run < 20; run += 1) windowReplaySamples(samples);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(250);
  });
});
