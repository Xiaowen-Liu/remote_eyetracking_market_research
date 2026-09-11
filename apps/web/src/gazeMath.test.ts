import { describe, expect, it } from "vitest";
import { calibrationError, fitGazeModel, predictGaze, type CalibrationSample } from "./gazeMath";

describe("calibration mapping", () => {
  it("fits an affine screen mapping from eye features", () => {
    const samples: CalibrationSample[] = [
      { feature: [0, 0], target: [0.1, 0.2] }, { feature: [1, 0], target: [0.8, 0.2] },
      { feature: [0, 1], target: [0.1, 0.7] }, { feature: [1, 1], target: [0.8, 0.7] },
      { feature: [0.5, 0.5], target: [0.45, 0.45] },
    ];
    const model = fitGazeModel(samples);
    expect(model).not.toBeNull();
    expect(predictGaze(model!, [0.5, 0.5])[0]).toBeCloseTo(0.45, 2);
    expect(calibrationError(model!, samples)).toBeLessThan(0.01);
  });
});
