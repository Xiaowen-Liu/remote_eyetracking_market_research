import { useState } from "react";

import type { AggregateAoiMetric } from "./aoiMetrics";

export type AoiDetailView = "summary" | "sessions" | "visits" | "samples";

/** Own AOI drill-down navigation and derive lower-level rows from aggregate metrics. */
export function useAoiDrillDown(
  metrics: AggregateAoiMetric[],
  currentReplaySessionId: string | null,
) {
  const [selectedAoiId, setSelectedAoiId] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<AoiDetailView>("summary");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [visitIndex, setVisitIndex] = useState<number | null>(null);

  const selectedMetric = metrics.find((metric) => metric.aoi.id === selectedAoiId) ?? null;
  const activeSessionId = sessionId ?? currentReplaySessionId;
  const sessionMetric =
    selectedMetric?.sessionMetrics.find((metric) => metric.sessionId === activeSessionId) ?? null;
  const visit = visitIndex == null ? null : (sessionMetric?.visits[visitIndex] ?? null);
  const samples = visit?.samples ?? sessionMetric?.samples ?? [];

  function selectAoi(aoiId: string) {
    setSelectedAoiId(aoiId);
    setDetailView("summary");
    setSessionId(currentReplaySessionId);
    setVisitIndex(null);
  }

  function clearAoi(aoiId: string) {
    setSelectedAoiId((current) => (current === aoiId ? null : current));
  }

  return {
    selectedAoiId,
    selectedMetric,
    detailView,
    setDetailView,
    activeSessionId,
    setSessionId,
    visitIndex,
    setVisitIndex,
    sessionMetric,
    visit,
    samples,
    selectAoi,
    clearAoi,
  };
}
