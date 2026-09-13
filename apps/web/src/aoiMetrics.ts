import type { CollectorGazeSample } from "./collectorArtifact";

export type AoiRectangle = { id: string; label: string; x: number; y: number; width: number; height: number };
export type AoiVisit = { startedAt: string; endedAt: string; durationMs: number; samples: CollectorGazeSample[]; meaningful: boolean };
export type AoiMetric = {
  aoi: AoiRectangle;
  sampleCount: number;
  dwellMs: number;
  dwellProportion: number;
  ttffMs: number | null;
  firstMeaningfulLatencyMs: number | null;
  firstMeaningfulDurationMs: number | null;
  revisitCount: number;
  visits: AoiVisit[];
  samples: CollectorGazeSample[];
};

const meaningfulVisitMs = 300;
const visitGapMs = 350;

function timestamp(sample: CollectorGazeSample, fallback: number) {
  if (!sample.at) return fallback;
  const parsed = Date.parse(sample.at);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateAoiMetrics(aois: AoiRectangle[], samples: CollectorGazeSample[], sessionStartedAt: string): AoiMetric[] {
  const sessionStart = Date.parse(sessionStartedAt);
  const ordered = samples.map((sample, index) => ({ sample, time: timestamp(sample, sessionStart + index * 100) })).sort((a, b) => a.time - b.time);
  const totalDwell = Math.max(1, ordered.slice(1).reduce((sum, item, index) => sum + Math.min(250, Math.max(0, item.time - ordered[index].time)), 0));
  return aois.map((aoi) => {
    const matching = ordered.filter(({ sample }) => sample.x >= aoi.x && sample.x <= aoi.x + aoi.width && sample.y >= aoi.y && sample.y <= aoi.y + aoi.height);
    const groups: typeof matching[] = [];
    for (const item of matching) {
      const group = groups.at(-1);
      if (!group || item.time - group.at(-1)!.time > visitGapMs) groups.push([item]);
      else group.push(item);
    }
    const visits = groups.map((group) => {
      const started = group[0].time;
      const ended = group.at(-1)!.time;
      const durationMs = Math.max(100, ended - started + 100);
      return { startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(), durationMs, samples: group.map(({ sample }) => sample), meaningful: durationMs >= meaningfulVisitMs };
    });
    const dwellMs = visits.reduce((sum, visit) => sum + visit.durationMs, 0);
    const meaningful = visits.find((visit) => visit.meaningful) ?? null;
    return {
      aoi,
      sampleCount: matching.length,
      dwellMs,
      dwellProportion: dwellMs / totalDwell,
      ttffMs: matching.length ? Math.max(0, matching[0].time - sessionStart) : null,
      firstMeaningfulLatencyMs: meaningful ? Math.max(0, Date.parse(meaningful.startedAt) - sessionStart) : null,
      firstMeaningfulDurationMs: meaningful?.durationMs ?? null,
      revisitCount: Math.max(0, visits.length - 1),
      visits,
      samples: matching.map(({ sample }) => sample),
    };
  });
}

export const AOI_MEANINGFUL_VISIT_MS = meaningfulVisitMs;
