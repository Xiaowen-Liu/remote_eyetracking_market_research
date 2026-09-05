export const SESSION_SCHEMA_VERSION = '1.0';

export function createDefaultState() {
  return {
    phase: 'idle',
    sessionId: null,
    participantId: null,
    startedAt: null,
    activeTabId: null,
    gazePoints: [],
    screenshots: [],
    dwellTimes: {},
    aois: [],
  };
}

export function normalizeGazePoint(payload = {}) {
  const x = Number(payload.x);
  const y = Number(payload.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    x: Math.round(x),
    y: Math.round(y),
    ts: Number.isFinite(Number(payload.ts)) ? Number(payload.ts) : Date.now(),
    url: typeof payload.url === 'string' ? payload.url : '',
  };
}

export function addDwellSample(dwellTimes, gazePoint, aois, sampleDurationMs = 100) {
  const url = gazePoint.url || '';
  if (!dwellTimes[url]) dwellTimes[url] = {};

  for (const aoi of aois) {
    const values = [aoi.x, aoi.y, aoi.w, aoi.h].map(Number);
    if (!values.every(Number.isFinite)) continue;
    const [x, y, width, height] = values;
    if (
      gazePoint.x >= x && gazePoint.x <= x + width &&
      gazePoint.y >= y && gazePoint.y <= y + height
    ) {
      const label = aoi.label || `aoi_${x}_${y}`;
      dwellTimes[url][label] = (dwellTimes[url][label] || 0) + sampleDurationMs;
    }
  }

  return dwellTimes;
}

export function buildSessionExport(state, now = Date.now()) {
  const duration = state.startedAt ? Math.max(0, now - state.startedAt) : 0;
  const gazePoints = Array.isArray(state.gazePoints) ? state.gazePoints : [];
  const screenshots = Array.isArray(state.screenshots) ? state.screenshots : [];
  const pageSummaries = {};

  for (const [url, dwellTimes] of Object.entries(state.dwellTimes || {})) {
    pageSummaries[url] = {
      gazePointCount: gazePoints.filter((point) => point.url === url).length,
      dwellTimes,
    };
  }

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: state.sessionId,
    participantId: state.participantId || 'anonymous',
    startedAt: state.startedAt,
    exportedAt: now,
    durationMs: duration,
    totalGazePoints: gazePoints.length,
    screenshotCount: screenshots.length,
    aois: Array.isArray(state.aois) ? state.aois : [],
    pageSummaries,
    gazePoints,
    screenshots,
    privacy: {
      processing: 'on-device',
      containsScreenshots: screenshots.length > 0,
      containsRawCameraVideo: false,
    },
  };
}

export function validateSessionExport(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Session must be a JSON object.'] };
  }
  if (typeof data.sessionId !== 'string' || !data.sessionId.trim()) {
    errors.push('sessionId must be a non-empty string.');
  }
  if (!Array.isArray(data.gazePoints)) errors.push('gazePoints must be an array.');
  if (!Array.isArray(data.screenshots)) errors.push('screenshots must be an array.');
  if (data.schemaVersion !== SESSION_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${String(data.schemaVersion)}.`);
  }

  return { valid: errors.length === 0, errors };
}
