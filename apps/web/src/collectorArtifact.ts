export type CollectorEvent = {
  type: string;
  url: string;
  at: string;
  detail?: unknown;
};

export type CollectorSnapshot = {
  at: string;
  url?: string;
  reason?: string;
  dataUrl: string;
  viewport?: { width: number; height: number };
  scroll?: { x: number; y: number };
};

export type CollectorGazeSample = {
  x: number;
  y: number;
  at?: string;
  confidence?: number;
  url?: string;
  viewport?: { width: number; height: number };
  scroll?: { x: number; y: number };
  aoiId?: string;
};

export type CollectorCalibration = {
  attempt: number;
  observed_sample_count: number;
  error_px: number | null;
  quality_grade: "strong" | "variable" | "limited" | "failed";
  accepted: boolean;
};

export type HeatCell = { x: number; y: number; count: number; intensity: number };
export type DomProposal = {
  label: string;
  tag: string;
  role?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  canonicalKey?: string;
};
export type DomProposalState = {
  at: string;
  url: string;
  trigger: string;
  proposals: DomProposal[];
};

export type CollectorArtifact = {
  schemaVersion: "1.0";
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  captureSnapshots: boolean;
  events: CollectorEvent[];
  snapshots: CollectorSnapshot[];
  gazeSamples?: CollectorGazeSample[];
  calibration?: CollectorCalibration;
  privacy: {
    rawCameraVideo: false;
    eventCollection: true;
    visibleTabSnapshots: boolean;
  };
};

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Validate the exported, clean-room extension artifact before rendering it locally. */
export function parseCollectorArtifact(value: unknown): CollectorArtifact {
  if (!value || typeof value !== "object") throw new Error("Choose a collector JSON export.");
  const artifact = value as Partial<CollectorArtifact>;
  if (
    artifact.schemaVersion !== "1.0" ||
    typeof artifact.sessionId !== "string" ||
    !isIsoTimestamp(artifact.startedAt)
  ) {
    throw new Error("This is not a supported WebGaze collector export.");
  }
  if (!Array.isArray(artifact.events) || !Array.isArray(artifact.snapshots) || !artifact.privacy) {
    throw new Error("The collector export is missing required session fields.");
  }
  if (artifact.privacy.rawCameraVideo !== false || artifact.privacy.eventCollection !== true) {
    throw new Error("This export does not meet the collector privacy contract.");
  }
  const events = artifact.events.filter(
    (event): event is CollectorEvent =>
      Boolean(event) &&
      typeof event.type === "string" &&
      typeof event.url === "string" &&
      isIsoTimestamp(event.at),
  );
  const snapshots = artifact.snapshots.filter(
    (snapshot): snapshot is CollectorSnapshot =>
      Boolean(snapshot) &&
      typeof snapshot.dataUrl === "string" &&
      snapshot.dataUrl.startsWith("data:image/") &&
      isIsoTimestamp(snapshot.at),
  );
  const gazeSamples = Array.isArray(artifact.gazeSamples)
    ? artifact.gazeSamples.filter(
        (sample): sample is CollectorGazeSample =>
          Boolean(sample) &&
          Number.isFinite(sample.x) &&
          Number.isFinite(sample.y) &&
          sample.x >= 0 &&
          sample.x <= 1 &&
          sample.y >= 0 &&
          sample.y <= 1,
      )
    : [];
  const rawCalibration = artifact.calibration as Partial<CollectorCalibration> | undefined;
  const calibration =
    rawCalibration &&
    Number.isFinite(rawCalibration.attempt) &&
    Number.isFinite(rawCalibration.observed_sample_count) &&
    (rawCalibration.error_px === null || Number.isFinite(rawCalibration.error_px)) &&
    ["strong", "variable", "limited", "failed"].includes(String(rawCalibration.quality_grade)) &&
    typeof rawCalibration.accepted === "boolean"
      ? (rawCalibration as CollectorCalibration)
      : undefined;
  return {
    schemaVersion: "1.0",
    sessionId: artifact.sessionId,
    startedAt: artifact.startedAt,
    endedAt: isIsoTimestamp(artifact.endedAt) ? artifact.endedAt : undefined,
    captureSnapshots: artifact.captureSnapshots === true,
    events,
    snapshots,
    gazeSamples,
    calibration,
    privacy: artifact.privacy,
  };
}

export function gazeSamplesForSnapshot(
  artifact: CollectorArtifact,
  snapshotIndex: number,
): CollectorGazeSample[] {
  const snapshot = artifact.snapshots[snapshotIndex];
  if (!snapshot) return [];
  const start =
    snapshotIndex > 0
      ? Date.parse(artifact.snapshots[snapshotIndex - 1].at)
      : Date.parse(artifact.startedAt);
  const end =
    snapshotIndex < artifact.snapshots.length - 1
      ? Date.parse(artifact.snapshots[snapshotIndex + 1].at)
      : Date.parse(artifact.endedAt ?? snapshot.at) + 1;
  return (artifact.gazeSamples ?? []).filter((sample) => {
    if (sample.url && snapshot.url && sample.url !== snapshot.url) return false;
    if (!sample.at) return artifact.snapshots.length === 1;
    const timestamp = Date.parse(sample.at);
    return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
  });
}

export function buildHeatmap(samples: CollectorGazeSample[], _gridSize = 14): HeatCell[] {
  if (!samples.length) return [];
  const fallbackIntervalMs = 100;
  const ordered = samples
    .map((sample, index) => ({
      sample,
      time: sample.at ? Date.parse(sample.at) : index * fallbackIntervalMs,
    }))
    .sort((left, right) => left.time - right.time);
  const fixations: Array<{
    samples: CollectorGazeSample[];
    started: number;
    ended: number;
  }> = [];
  for (const item of ordered) {
    const active = fixations.at(-1);
    const viewportWidth = item.sample.viewport?.width ?? 1280;
    const viewportHeight = item.sample.viewport?.height ?? 720;
    const centroid = active
      ? {
          x: active.samples.reduce((sum, sample) => sum + sample.x, 0) / active.samples.length,
          y: active.samples.reduce((sum, sample) => sum + sample.y, 0) / active.samples.length,
        }
      : null;
    const distancePx = centroid
      ? Math.hypot(
          (item.sample.x - centroid.x) * viewportWidth,
          (item.sample.y - centroid.y) * viewportHeight,
        )
      : Number.POSITIVE_INFINITY;
    if (active && distancePx <= 36) {
      active.samples.push(item.sample);
      active.ended = item.time;
    } else {
      fixations.push({ samples: [item.sample], started: item.time, ended: item.time });
    }
  }
  const weighted = fixations.map((fixation) => {
    const count = fixation.samples.length;
    const durationMs = Math.max(80, fixation.ended - fixation.started + fallbackIntervalMs);
    return {
      x: fixation.samples.reduce((sum, sample) => sum + sample.x, 0) / count,
      y: fixation.samples.reduce((sum, sample) => sum + sample.y, 0) / count,
      count,
      weight: Math.max(0.2, durationMs / 250),
    };
  });
  const maximum = Math.max(Number.EPSILON, ...weighted.map((fixation) => fixation.weight));
  return weighted.map(({ weight, ...fixation }) => ({
    ...fixation,
    intensity: weight / maximum,
  }));
}

export function domProposalStates(artifact: CollectorArtifact): DomProposalState[] {
  return artifact.events.flatMap((event) => {
    const detail = event.detail as
      { value?: { trigger?: unknown; proposals?: unknown } } | undefined;
    const value = detail?.value;
    if (!value || !Array.isArray(value.proposals)) return [];
    const proposals = value.proposals.filter((proposal): proposal is DomProposal => {
      if (!proposal || typeof proposal !== "object") return false;
      const candidate = proposal as Partial<DomProposal>;
      return (
        typeof candidate.label === "string" &&
        typeof candidate.tag === "string" &&
        [candidate.x, candidate.y, candidate.width, candidate.height].every(
          (number) => typeof number === "number" && Number.isFinite(number),
        )
      );
    });
    return proposals.length
      ? [
          {
            at: event.at,
            url: event.url,
            trigger: typeof value.trigger === "string" ? value.trigger : event.type,
            proposals,
          },
        ]
      : [];
  });
}
