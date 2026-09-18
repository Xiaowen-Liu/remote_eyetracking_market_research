import type { CollectorGazeSample } from "./collectorArtifact";

export type AoiRectangle = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type AoiVisit = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  samples: CollectorGazeSample[];
  fixation: boolean;
  meaningful: boolean;
  fixationLatencyMs: number | null;
};
export type AoiMetric = {
  aoi: AoiRectangle;
  sampleCount: number;
  dwellMs: number;
  dwellProportion: number;
  ttffMs: number | null;
  firstMeaningfulLatencyMs: number | null;
  firstMeaningfulDurationMs: number | null;
  revisitCount: number;
  fixationCount: number;
  visits: AoiVisit[];
  samples: CollectorGazeSample[];
};

export type SessionAoiMetric = AoiMetric & {
  sessionId: string;
  sessionStartedAt: string;
  sessionEndedAt?: string;
};

export type AggregateAoiMetric = {
  aoi: AoiRectangle;
  applicableSessions: number;
  noticedSessions: number;
  exposureRate: number;
  averageDwellMs: number;
  averageDwellProportion: number;
  medianTtffMs: number | null;
  medianFirstMeaningfulLatencyMs: number | null;
  averageFirstMeaningfulDurationMs: number | null;
  revisitRate: number;
  sessionMetrics: SessionAoiMetric[];
};

const meaningfulVisitMs = 500;
const fixationVisitMs = 180;
const visitGapMs = 350;
const fallbackSampleMs = 100;

type TimedSample = { sample: CollectorGazeSample; time: number; aoiId: string | null };

function timestamp(sample: CollectorGazeSample, fallback: number) {
  if (!sample.at) return fallback;
  const parsed = Date.parse(sample.at);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function contains(aoi: AoiRectangle, sample: CollectorGazeSample, toleranceX = 0, toleranceY = 0) {
  return (
    sample.x >= aoi.x - toleranceX &&
    sample.x <= aoi.x + aoi.width + toleranceX &&
    sample.y >= aoi.y - toleranceY &&
    sample.y <= aoi.y + aoi.height + toleranceY
  );
}

function centerDistance(aoi: AoiRectangle, sample: CollectorGazeSample) {
  return Math.hypot(sample.x - (aoi.x + aoi.width / 2), sample.y - (aoi.y + aoi.height / 2));
}

export function assignSampleToAoi(
  aois: AoiRectangle[],
  sample: CollectorGazeSample,
): string | null {
  if (sample.aoiId && aois.some((aoi) => aoi.id === sample.aoiId)) return sample.aoiId;

  const exact = aois.filter((aoi) => contains(aoi, sample));
  const candidates = exact.length
    ? exact
    : aois.filter((aoi) => {
        const toleranceX = Math.max(
          aoi.width * 0.08,
          14 / Math.max(1, sample.viewport?.width ?? 1280),
        );
        const toleranceY = Math.max(
          aoi.height * 0.08,
          14 / Math.max(1, sample.viewport?.height ?? 720),
        );
        return contains(aoi, sample, toleranceX, toleranceY);
      });
  return (
    candidates.sort(
      (left, right) => centerDistance(left, sample) - centerDistance(right, sample),
    )[0]?.id ?? null
  );
}

function buildVisits(ordered: TimedSample[]) {
  const raw: Array<{
    aoiId: string;
    started: number;
    ended: number;
    samples: CollectorGazeSample[];
  }> = [];
  let current: (typeof raw)[number] | null = null;
  for (const item of ordered) {
    if (current && item.aoiId === current.aoiId && item.time - current.ended <= visitGapMs) {
      current.ended = item.time;
      current.samples.push(item.sample);
      continue;
    }
    if (current) raw.push(current);
    current = item.aoiId
      ? { aoiId: item.aoiId, started: item.time, ended: item.time, samples: [item.sample] }
      : null;
  }
  if (current) raw.push(current);

  const merged: typeof raw = [];
  for (const visit of raw) {
    const previous = merged.at(-1);
    if (previous?.aoiId === visit.aoiId && visit.started - previous.ended <= visitGapMs) {
      previous.ended = visit.ended;
      previous.samples.push(...visit.samples);
    } else {
      merged.push({ ...visit, samples: [...visit.samples] });
    }
  }
  return merged;
}

export function calculateAoiMetrics(
  aois: AoiRectangle[],
  samples: CollectorGazeSample[],
  sessionStartedAt: string,
): AoiMetric[] {
  const parsedSessionStart = Date.parse(sessionStartedAt);
  const sessionStart = Number.isFinite(parsedSessionStart) ? parsedSessionStart : 0;
  const ordered = samples
    .map((sample, index) => ({
      sample,
      time: timestamp(sample, sessionStart + index * fallbackSampleMs),
      aoiId: assignSampleToAoi(aois, sample),
    }))
    .sort((left, right) => left.time - right.time);
  const visits = buildVisits(ordered);
  const totalAoiDwell = Math.max(
    1,
    visits.reduce(
      (sum, visit) =>
        sum + Math.max(fallbackSampleMs, visit.ended - visit.started + fallbackSampleMs),
      0,
    ),
  );

  return aois.map((aoi) => {
    const matching = ordered.filter((item) => item.aoiId === aoi.id);
    const aoiVisits: AoiVisit[] = visits
      .filter((visit) => visit.aoiId === aoi.id)
      .map((visit) => {
        const durationMs = Math.max(
          fallbackSampleMs,
          visit.ended - visit.started + fallbackSampleMs,
        );
        return {
          startedAt: new Date(visit.started).toISOString(),
          endedAt: new Date(visit.ended).toISOString(),
          durationMs,
          samples: visit.samples,
          fixation: durationMs >= fixationVisitMs,
          meaningful: durationMs >= meaningfulVisitMs,
          fixationLatencyMs: durationMs >= fixationVisitMs ? fixationVisitMs : null,
        };
      });
    const dwellMs = aoiVisits.reduce((sum, visit) => sum + visit.durationMs, 0);
    const meaningful = aoiVisits.find((visit) => visit.meaningful) ?? null;
    const firstVisit = aoiVisits[0] ?? null;
    return {
      aoi,
      sampleCount: matching.length,
      dwellMs,
      dwellProportion: dwellMs / totalAoiDwell,
      ttffMs: firstVisit ? Math.max(0, Date.parse(firstVisit.startedAt) - sessionStart) : null,
      firstMeaningfulLatencyMs: meaningful
        ? Math.max(0, Date.parse(meaningful.startedAt) - sessionStart)
        : null,
      firstMeaningfulDurationMs: meaningful?.durationMs ?? null,
      revisitCount: Math.max(0, aoiVisits.filter((visit) => visit.meaningful).length - 1),
      fixationCount: aoiVisits.filter((visit) => visit.fixation).length,
      visits: aoiVisits,
      samples: matching.map(({ sample }) => sample),
    };
  });
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function aggregateAoiMetrics(
  aois: AoiRectangle[],
  sessions: Array<{
    sessionId: string;
    startedAt: string;
    endedAt?: string;
    samples: CollectorGazeSample[];
  }>,
  isApplicable: (aoi: AoiRectangle, sessionId: string) => boolean = () => true,
): AggregateAoiMetric[] {
  const metricsBySession = new Map(
    sessions.map((session) => [
      session.sessionId,
      calculateAoiMetrics(
        aois.filter((aoi) => isApplicable(aoi, session.sessionId)),
        session.samples,
        session.startedAt,
      ),
    ]),
  );
  return aois
    .map((aoi) => {
      const sessionMetrics = sessions.flatMap((session) => {
        if (!isApplicable(aoi, session.sessionId)) return [];
        const metric = metricsBySession
          .get(session.sessionId)
          ?.find((item) => item.aoi.id === aoi.id);
        return metric
          ? [
              {
                ...metric,
                sessionId: session.sessionId,
                sessionStartedAt: session.startedAt,
                sessionEndedAt: session.endedAt,
              },
            ]
          : [];
      });
      const noticed = sessionMetrics.filter((metric) => metric.dwellMs > 0);
      const ttff = noticed.flatMap((metric) => (metric.ttffMs == null ? [] : [metric.ttffMs]));
      const latency = noticed.flatMap((metric) =>
        metric.firstMeaningfulLatencyMs == null ? [] : [metric.firstMeaningfulLatencyMs],
      );
      const duration = noticed.flatMap((metric) =>
        metric.firstMeaningfulDurationMs == null ? [] : [metric.firstMeaningfulDurationMs],
      );
      return {
        aoi,
        applicableSessions: sessionMetrics.length,
        noticedSessions: noticed.length,
        exposureRate: sessionMetrics.length ? noticed.length / sessionMetrics.length : 0,
        averageDwellMs: average(noticed.map((metric) => metric.dwellMs)),
        averageDwellProportion: average(sessionMetrics.map((metric) => metric.dwellProportion)),
        medianTtffMs: median(ttff),
        medianFirstMeaningfulLatencyMs: median(latency),
        averageFirstMeaningfulDurationMs: duration.length ? average(duration) : null,
        revisitRate: sessionMetrics.length
          ? sessionMetrics.filter((metric) => metric.revisitCount > 0).length /
            sessionMetrics.length
          : 0,
        sessionMetrics,
      };
    })
    .sort((left, right) => right.exposureRate - left.exposureRate);
}

export const AOI_MEANINGFUL_VISIT_MS = meaningfulVisitMs;
export const AOI_FIXATION_VISIT_MS = fixationVisitMs;
