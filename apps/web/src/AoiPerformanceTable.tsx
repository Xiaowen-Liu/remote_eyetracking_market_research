import type { AggregateAoiMetric } from "./aoiMetrics";

const descriptions = {
  exposure: "Share of applicable sessions with dwell above zero.",
  dwell: "Average total dwell among sessions that noticed this AOI.",
  proportion: "Average per-session share of dwell across applicable AOIs.",
  ttff: "Median delay before this AOI was first noticed.",
  meaningfulLatency: "Median delay before the first visit lasting at least 500 ms.",
  meaningfulDuration: "Average duration of the first meaningful visit.",
  revisit: "Share of applicable sessions containing a meaningful revisit.",
};

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function MetricHeading({ label, description }: { label: string; description: string }) {
  return (
    <span>
      {label}{" "}
      <button
        type="button"
        className="metric-info"
        aria-label={`${label}: ${description}`}
        data-tip={description}
      >
        i
      </button>
    </span>
  );
}

export function SpectrumMeter({ value }: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = percent >= 72 ? "high" : percent >= 38 ? "medium" : percent > 0 ? "low" : "zero";
  return (
    <span className={`spectrum-meter ${tone}`}>
      <b>{percent}%</b>
      <span>
        <i style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

export function AoiPerformanceTable({
  metrics,
  visibleSessionCount,
  onSelect,
}: {
  metrics: AggregateAoiMetric[];
  visibleSessionCount: number;
  onSelect: (aoiId: string) => void;
}) {
  return (
    <>
      <div className="aoi-metrics-heading">
        <div>
          <p className="eyebrow">AOI metrics</p>
          <h2>AOI Performance Table</h2>
          <p>Metrics deserve their own surface. They are not side notes to replay.</p>
          <p>
            These metrics are recomputed from saved raw gaze samples using the current study AOIs,
            so newly added AOIs can appear for older sessions too.
          </p>
          <p>Scope: aggregated across all sessions stored in this analysis workspace.</p>
        </div>
        <span className="context-chip">
          {visibleSessionCount} visible session{visibleSessionCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="session-table-wrap">
        <table className="session-table aoi-table">
          <thead>
            <tr>
              <th>Area of interest</th>
              <th>
                <MetricHeading label="Exposure %" description={descriptions.exposure} />
              </th>
              <th>
                <MetricHeading label="Avg dwell" description={descriptions.dwell} />
              </th>
              <th>
                <MetricHeading label="Avg proportion dwell" description={descriptions.proportion} />
              </th>
              <th>
                <MetricHeading label="Median TTFF" description={descriptions.ttff} />
              </th>
              <th>
                <MetricHeading
                  label="Meaningful latency"
                  description={descriptions.meaningfulLatency}
                />
              </th>
              <th>
                <MetricHeading
                  label="Meaningful duration"
                  description={descriptions.meaningfulDuration}
                />
              </th>
              <th>
                <MetricHeading label="Revisit rate" description={descriptions.revisit} />
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.aoi.id}>
                <td>
                  <button
                    className="aoi-name-button"
                    type="button"
                    onClick={() => onSelect(metric.aoi.id)}
                  >
                    › {metric.aoi.label}
                  </button>
                </td>
                <td>
                  <SpectrumMeter value={metric.exposureRate} />
                </td>
                <td>{formatTime(metric.averageDwellMs)}</td>
                <td>{Math.round(metric.averageDwellProportion * 100)}%</td>
                <td>{metric.medianTtffMs == null ? "—" : formatTime(metric.medianTtffMs)}</td>
                <td>
                  {metric.medianFirstMeaningfulLatencyMs == null
                    ? "—"
                    : formatTime(metric.medianFirstMeaningfulLatencyMs)}
                </td>
                <td>
                  {metric.averageFirstMeaningfulDurationMs == null
                    ? "—"
                    : formatTime(metric.averageFirstMeaningfulDurationMs)}
                </td>
                <td>{Math.round(metric.revisitRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
