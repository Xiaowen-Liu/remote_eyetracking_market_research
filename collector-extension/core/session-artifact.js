export function newSession({ sessionId, captureSnapshots = false }) {
  return {
    schemaVersion: "1.0",
    sessionId,
    startedAt: new Date().toISOString(),
    captureSnapshots,
    events: [],
    snapshots: [],
  };
}

export function addEvent(session, event) {
  if (!session || !event?.type || !event?.url) return session;
  return {
    ...session,
    events: [
      ...session.events,
      {
        type: event.type,
        url: event.url,
        at: event.at ?? new Date().toISOString(),
        detail: event.detail ?? null,
      },
    ],
  };
}

export function addSnapshot(session, snapshot) {
  if (!session.captureSnapshots || !snapshot?.dataUrl) return session;
  return {
    ...session,
    snapshots: [
      ...session.snapshots,
      {
        at: snapshot.at ?? new Date().toISOString(),
        url: snapshot.url,
        reason: snapshot.reason,
        dataUrl: snapshot.dataUrl,
        viewport: snapshot.viewport,
        scroll: snapshot.scroll,
      },
    ],
  };
}

export function exportArtifact(session, endedAt = new Date().toISOString()) {
  return {
    schemaVersion: session.schemaVersion ?? "1.0",
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    endedAt,
    captureSnapshots: session.captureSnapshots === true,
    events: session.events ?? [],
    snapshots: session.snapshots ?? [],
    gazeSamples: session.gazeSamples ?? [],
    ...(session.calibration ? { calibration: session.calibration } : {}),
    privacy: {
      rawCameraVideo: false,
      eventCollection: true,
      visibleTabSnapshots: session.captureSnapshots === true,
    },
  };
}

export function replayContextPayload(session, endedAt = new Date().toISOString()) {
  const artifact = exportArtifact(session, endedAt);
  return {
    schemaVersion: artifact.schemaVersion,
    startedAt: artifact.startedAt,
    endedAt: artifact.endedAt,
    captureSnapshots: artifact.captureSnapshots,
    events: artifact.events,
    snapshots: artifact.snapshots,
  };
}
