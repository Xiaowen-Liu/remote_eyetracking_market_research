import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDwellSample,
  buildSessionExport,
  createDefaultState,
  normalizeGazePoint,
  validateSessionExport,
} from '../extension/core/session.js';

test('creates isolated default state objects', () => {
  const first = createDefaultState();
  const second = createDefaultState();
  first.gazePoints.push({ x: 1, y: 1 });
  assert.equal(second.gazePoints.length, 0);
});

test('normalizes coordinates and rejects malformed samples', () => {
  assert.deepEqual(
    normalizeGazePoint({ x: 10.4, y: '20.7', ts: 42, url: 'https://example.test' }),
    { x: 10, y: 21, ts: 42, url: 'https://example.test' },
  );
  assert.equal(normalizeGazePoint({ x: 'not-a-number', y: 20 }), null);
});

test('counts dwell only inside valid areas of interest', () => {
  const dwell = {};
  const aois = [{ label: 'Checkout', x: 10, y: 10, w: 100, h: 50 }];
  addDwellSample(dwell, { x: 25, y: 30, url: 'https://example.test' }, aois);
  addDwellSample(dwell, { x: 250, y: 30, url: 'https://example.test' }, aois);
  assert.deepEqual(dwell, { 'https://example.test': { Checkout: 100 } });
});

test('builds a versioned, privacy-explicit session export', () => {
  const state = createDefaultState();
  Object.assign(state, {
    sessionId: 'session_1',
    participantId: 'P-001',
    startedAt: 1_000,
    gazePoints: [{ x: 1, y: 2, ts: 1_100, url: 'https://example.test' }],
    screenshots: [],
    dwellTimes: { 'https://example.test': {} },
  });
  const result = buildSessionExport(state, 2_000);
  assert.equal(result.durationMs, 1_000);
  assert.equal(result.totalGazePoints, 1);
  assert.equal(result.pageSummaries['https://example.test'].gazePointCount, 1);
  assert.deepEqual(result.privacy, {
    processing: 'on-device',
    containsScreenshots: false,
    containsRawCameraVideo: false,
  });
});

test('rejects incompatible or malformed imported sessions', () => {
  const result = validateSessionExport({ schemaVersion: '2.0', gazePoints: [], screenshots: [] });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});
