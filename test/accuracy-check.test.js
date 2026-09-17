import assert from "node:assert/strict";
import test from "node:test";

import { median, summarizeAccuracy } from "../collector-extension/core/accuracy-check.js";

test("uses coordinate medians for validation error", () => {
  assert.equal(median([20, 1, 10]), 10);
  assert.equal(median([1, 3, 7, 9]), 5);
  const result = summarizeAccuracy(
    [
      [0.5, 0.5],
      [0.5, 0.5],
      [1, 1],
    ],
    1000,
    800,
    3,
  );
  assert.equal(result.validationErrorPx, 0);
});

test("scores distance linearly and treats missing buffered samples as centered", () => {
  const result = summarizeAccuracy([[0.5, 1]], 1000, 800, 2);
  assert.equal(result.accuracyPercent, 50);
  assert.equal(result.sampleCount, 1);
});

test("keeps only the most recent configured number of predictions", () => {
  const result = summarizeAccuracy(
    [
      [0, 0],
      [0.5, 0.5],
      [0.5, 0.5],
    ],
    1000,
    800,
    2,
  );
  assert.equal(result.accuracyPercent, 100);
  assert.equal(result.sampleCount, 2);
});
