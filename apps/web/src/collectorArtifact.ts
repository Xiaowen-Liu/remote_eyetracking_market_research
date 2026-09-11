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
};

export type CollectorArtifact = {
  schemaVersion: "1.0";
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  captureSnapshots: boolean;
  events: CollectorEvent[];
  snapshots: CollectorSnapshot[];
  gazeSamples?: Array<{ x: number; y: number; at?: string; confidence?: number }>;
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
    ? artifact.gazeSamples.filter((sample): sample is { x: number; y: number; at?: string; confidence?: number } =>
      Boolean(sample) && Number.isFinite(sample.x) && Number.isFinite(sample.y),
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
