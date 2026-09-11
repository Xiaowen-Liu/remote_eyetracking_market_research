export type GazeFeature = readonly [number, number];
export type CalibrationSample = { feature: GazeFeature; target: readonly [number, number] };
export type GazeModel = { x: number[]; y: number[] };

function solve(matrix: number[][], vector: number[]): number[] | null {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < rows.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-8) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const scale = rows[column][column];
    rows[column] = rows[column].map((value) => value / scale);
    for (let row = 0; row < rows.length; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      rows[row] = rows[row].map((value, index) => value - factor * rows[column][index]);
    }
  }
  return rows.map((row) => row[row.length - 1]);
}

function fitAxis(samples: CalibrationSample[], axis: 0 | 1): number[] | null {
  // [1, iris-x, iris-y] -> normalized screen coordinate, with small ridge term.
  const normal = Array.from({ length: 3 }, () => Array(3).fill(0));
  const target = Array(3).fill(0);
  for (const sample of samples) {
    const vector = [1, sample.feature[0], sample.feature[1]];
    for (let row = 0; row < 3; row += 1) {
      target[row] += vector[row] * sample.target[axis];
      for (let column = 0; column < 3; column += 1) normal[row][column] += vector[row] * vector[column];
    }
  }
  for (let index = 0; index < 3; index += 1) normal[index][index] += 0.0001;
  return solve(normal, target);
}

export function fitGazeModel(samples: CalibrationSample[]): GazeModel | null {
  if (samples.length < 5) return null;
  const x = fitAxis(samples, 0);
  const y = fitAxis(samples, 1);
  return x && y ? { x, y } : null;
}

export function predictGaze(model: GazeModel, feature: GazeFeature): GazeFeature {
  const vector = [1, feature[0], feature[1]];
  const dot = (weights: number[]) => weights.reduce((sum, weight, index) => sum + weight * vector[index], 0);
  return [Math.min(1, Math.max(0, dot(model.x))), Math.min(1, Math.max(0, dot(model.y)))];
}

export function calibrationError(model: GazeModel, samples: CalibrationSample[]): number {
  if (!samples.length) return Infinity;
  const squared = samples.reduce((sum, sample) => {
    const prediction = predictGaze(model, sample.feature);
    return sum + (prediction[0] - sample.target[0]) ** 2 + (prediction[1] - sample.target[1]) ** 2;
  }, 0);
  return Math.sqrt(squared / samples.length);
}
