import type { CollectorArtifact } from "./collectorArtifact";

export type SessionHealth = {
  grade: "good" | "usable" | "directional" | "invalid";
  durationMs: number;
  sampleRateHz: number;
  meanConfidence: number | null;
  explanation: string;
};

export function collectorSessionHealth(artifact: CollectorArtifact): SessionHealth {
  const durationMs = Math.max(
    0,
    Date.parse(artifact.endedAt ?? artifact.startedAt) - Date.parse(artifact.startedAt),
  );
  const samples = artifact.gazeSamples ?? [];
  const confidences = samples
    .map((sample) => sample.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const meanConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : null;
  const sampleRateHz = durationMs > 0 ? samples.length / (durationMs / 1000) : 0;
  const calibration = artifact.calibration?.quality_grade;

  let grade: SessionHealth["grade"];
  if (!artifact.endedAt || samples.length < 10 || calibration === "failed") grade = "invalid";
  else if (
    calibration === "variable" ||
    sampleRateHz < 2 ||
    (meanConfidence !== null && meanConfidence < 0.55)
  )
    grade = "directional";
  else if (!calibration || sampleRateHz < 5 || (meanConfidence !== null && meanConfidence < 0.75))
    grade = "usable";
  else grade = "good";

  const confidence =
    meanConfidence === null
      ? "confidence unavailable"
      : `mean confidence ${meanConfidence.toFixed(2)}`;
  const calibrationText = calibration
    ? `${calibration} calibration`
    : "calibration metadata unavailable";
  return {
    grade,
    durationMs,
    sampleRateHz,
    meanConfidence,
    explanation: `${samples.length.toLocaleString()} samples over ${(durationMs / 1000).toFixed(1)}s (${sampleRateHz.toFixed(1)} Hz), ${confidence}, ${calibrationText}. This is a transparent collection-health signal, not a validated accuracy claim.`,
  };
}
