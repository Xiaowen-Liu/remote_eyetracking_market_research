import test from "node:test";
import assert from "node:assert/strict";
import { createBoundaryPath, hasArrived, observeSegment, pointerSpeed } from "../collector-extension/core/boundary-calibration.js";

test("creates a closed 28px-inset boundary path", () => {
  const path = createBoundaryPath(1200, 800);
  assert.deepEqual(path, [
    { x: 28, y: 28 }, { x: 1172, y: 28 }, { x: 1172, y: 772 },
    { x: 28, y: 772 }, { x: 28, y: 28 },
  ]);
});

test("projects a pointer onto an edge and measures rail distance", () => {
  const observation = observeSegment({ x: 28, y: 28 }, { x: 1028, y: 28 }, { x: 528, y: 48 });
  assert.equal(observation.progress, 0.5);
  assert.equal(observation.distance, 20);
});

test("requires slow movement and accepts near or passed arrivals", () => {
  assert.equal(pointerSpeed({ x: 0, y: 0 }, { x: 60, y: 0 }, 100), 0.6);
  assert.equal(hasArrived(observeSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 96, y: 30 })), true);
  assert.equal(hasArrived(observeSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 105, y: 50 })), true);
  assert.equal(hasArrived(observeSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 70, y: 80 })), false);
});
