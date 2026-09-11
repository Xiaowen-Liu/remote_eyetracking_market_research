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
};

export type HeatCell = { x: number; y: number; count: number; intensity: number };

export type CollectorArtifact = {
  schemaVersion: "1.0";
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  captureSnapshots: boolean;
  events: CollectorEvent[];
  snapshots: CollectorSnapshot[];
  gazeSamples?: CollectorGazeSample[];
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
  if (artifact.schemaVersion !== "1.0" || typeof artifact.sessionId !== "string" || !isIsoTimestamp(artifact.startedAt)) {
    throw new Error("This is not a supported WebGaze collector export.");
  }
  if (!Array.isArray(artifact.events) || !Array.isArray(artifact.snapshots) || !artifact.privacy) {
    throw new Error("The collector export is missing required session fields.");
  }
  if (artifact.privacy.rawCameraVideo !== false || artifact.privacy.eventCollection !== true) {
    throw new Error("This export does not meet the collector privacy contract.");
  }
  const events = artifact.events.filter((event): event is CollectorEvent =>
    Boolean(event) && typeof event.type === "string" && typeof event.url === "string" && isIsoTimestamp(event.at),
  );
  const snapshots = artifact.snapshots.filter((snapshot): snapshot is CollectorSnapshot =>
    Boolean(snapshot) && typeof snapshot.dataUrl === "string" && snapshot.dataUrl.startsWith("data:image/") && isIsoTimestamp(snapshot.at),
  );
  const gazeSamples = Array.isArray(artifact.gazeSamples)
    ? artifact.gazeSamples.filter((sample): sample is CollectorGazeSample =>
      Boolean(sample) && Number.isFinite(sample.x) && Number.isFinite(sample.y) && sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1,
    )
    : [];
  return {
    schemaVersion: "1.0",
    sessionId: artifact.sessionId,
    startedAt: artifact.startedAt,
    endedAt: isIsoTimestamp(artifact.endedAt) ? artifact.endedAt : undefined,
    captureSnapshots: artifact.captureSnapshots === true,
    events,
    snapshots,
    gazeSamples,
    privacy: artifact.privacy,
  };
}

export function gazeSamplesForSnapshot(artifact: CollectorArtifact, snapshotIndex: number): CollectorGazeSample[] {
  const snapshot = artifact.snapshots[snapshotIndex];
  if (!snapshot) return [];
  const start = snapshotIndex > 0 ? Date.parse(artifact.snapshots[snapshotIndex - 1].at) : Date.parse(artifact.startedAt);
  const end = snapshotIndex < artifact.snapshots.length - 1
    ? Date.parse(artifact.snapshots[snapshotIndex + 1].at)
    : Date.parse(artifact.endedAt ?? snapshot.at) + 1;
  return (artifact.gazeSamples ?? []).filter((sample) => {
    if (sample.url && snapshot.url && sample.url !== snapshot.url) return false;
    if (!sample.at) return artifact.snapshots.length === 1;
    const timestamp = Date.parse(sample.at);
    return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
  });
}

export function buildHeatmap(samples: CollectorGazeSample[], gridSize = 14): HeatCell[] {
  const buckets = new Map<string, { x: number; y: number; count: number }>();
  for (const sample of samples) {
    const column = Math.min(gridSize - 1, Math.floor(sample.x * gridSize));
    const row = Math.min(gridSize - 1, Math.floor(sample.y * gridSize));
    const key = `${column}:${row}`;
    const bucket = buckets.get(key) ?? { x: (column + 0.5) / gridSize, y: (row + 0.5) / gridSize, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const maximum = Math.max(1, ...[...buckets.values()].map((bucket) => bucket.count));
  return [...buckets.values()].map((bucket) => ({ ...bucket, intensity: bucket.count / maximum }));
}
