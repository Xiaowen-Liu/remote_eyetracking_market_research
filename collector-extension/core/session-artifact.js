export function newSession({ sessionId, captureSnapshots = false }) {
  return { schemaVersion: "1.0", sessionId, startedAt: new Date().toISOString(), captureSnapshots, events: [], snapshots: [] };
}

export function addEvent(session, event) {
  if (!session || !event?.type || !event?.url) return session;
  return { ...session, events: [...session.events, { type: event.type, url: event.url, at: event.at ?? new Date().toISOString(), detail: event.detail ?? null }] };
}

export function addSnapshot(session, snapshot) {
  if (!session.captureSnapshots || !snapshot?.dataUrl) return session;
  return { ...session, snapshots: [...session.snapshots, { at: snapshot.at ?? new Date().toISOString(), url: snapshot.url, reason: snapshot.reason, dataUrl: snapshot.dataUrl, viewport: snapshot.viewport, scroll: snapshot.scroll }] };
}

export function exportArtifact(session, endedAt = new Date().toISOString()) {
  return { ...session, endedAt, privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: session.captureSnapshots } };
}
