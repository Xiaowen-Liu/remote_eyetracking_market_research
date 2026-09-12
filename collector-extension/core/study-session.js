export const defaultApiBase = "https://remoteeyetrackingmarketresearch-production.up.railway.app";

export function participantToken(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/participate\/([^/]+)/);
    return match?.[1] ?? null;
  } catch {
    return /^[A-Za-z0-9_-]{16,}$/.test(trimmed) ? trimmed : null;
  }
}

export function apiUrl(base, path) {
  return `${base.replace(/\/$/, "")}/api/v1${path}`;
}

export function gazeBatch(samples, sequence, id) {
  if (!samples.length) throw new Error("Cannot create an empty gaze batch");
  const timestamps = samples.map((sample) => sample.at).sort();
  return {
    client_batch_id: id,
    sequence,
    schema_version: "1.0",
    captured_from: timestamps[0],
    captured_to: timestamps[timestamps.length - 1],
    samples: samples.map((sample) => ({
      timestamp: sample.at,
      x_normalized: sample.x,
      y_normalized: sample.y,
      confidence: sample.confidence ?? null,
      scroll_x: sample.scroll?.x ?? 0,
      scroll_y: sample.scroll?.y ?? 0,
      viewport_width: sample.viewport?.width ?? 1,
      viewport_height: sample.viewport?.height ?? 1,
    })),
  };
}

export function nextBatchSequence(acknowledgedSequence, pendingBatches = []) {
  return acknowledgedSequence + pendingBatches.length;
}

export function calibrationPayload(result) {
  return {
    attempt: result.attempt,
    started_at: result.startedAt,
    completed_at: result.completedAt,
    target_count: 9,
    observed_sample_count: result.observedSampleCount,
    error_px: result.errorPx,
    quality_grade: result.qualityGrade,
    diagnostics: { source: "clean-room-extension", camera_frames_uploaded: false, calibration_rms_normalized: result.rms },
  };
}
