export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeAccuracy(points, width, height, sampleLimit = 50) {
  const samples = points.slice(-sampleLimit);
  const center = { x: width / 2, y: height / 2 };
  const measured = samples.length
    ? {
        x: median(samples.map(([x]) => x * width)),
        y: median(samples.map(([, y]) => y * height)),
      }
    : center;
  const validationErrorPx = Math.hypot(measured.x - center.x, measured.y - center.y);
  const maximumDistance = height / 2;
  const observedScore = samples.reduce((sum, [x, y]) => {
    const distance = Math.hypot(x * width - center.x, y * height - center.y);
    return sum + Math.max(0, 100 * (1 - distance / maximumDistance));
  }, 0);
  const missingScore = Math.max(0, sampleLimit - samples.length) * 100;
  return {
    accuracyPercent: (observedScore + missingScore) / sampleLimit,
    validationErrorPx,
    sampleCount: samples.length,
  };
}
