/**
 * Bound per-frame replay work without changing the stored artifact or exports.
 * Systematic sampling preserves the whole time range, including both endpoints,
 * instead of rendering only the beginning of a large session.
 */
export function windowReplaySamples<T>(samples: T[], maximum = 5_000): T[] {
  if (maximum < 2) throw new Error("Replay render window must contain at least two samples.");
  if (samples.length <= maximum) return samples;
  const lastIndex = samples.length - 1;
  return Array.from({ length: maximum }, (_, index) => samples[Math.round(index * lastIndex / (maximum - 1))]);
}
