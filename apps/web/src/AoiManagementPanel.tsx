import type { ReplayAoi } from "./useStudyAnalysisPreferences";

type Props = {
  aois: ReplayAoi[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<ReplayAoi>) => void;
};

export function AoiManagementPanel({ aois, onRemove, onUpdate }: Props) {
  if (!aois.length) return null;
  return (
    <details className="aoi-management">
      <summary>Areas of Interest · {aois.length}</summary>
      <p>
        Rename or fine-tune saved regions. Coordinate changes immediately recompute historical
        metrics.
      </p>
      <div className="aoi-management-list">
        {aois.map((aoi, index) => (
          <article key={aoi.id}>
            <div className="aoi-management-title">
              <strong>AOI {index + 1}</strong>
              <button className="text-button danger" type="button" onClick={() => onRemove(aoi.id)}>
                Remove
              </button>
            </div>
            <label>
              Label
              <input
                value={aoi.label}
                onChange={(event) => onUpdate(aoi.id, { label: event.target.value })}
              />
            </label>
            <span>
              Source: {aoi.source === "dom" ? "added from DOM proposal" : "manual AOI rectangle"}
            </span>
            {aoi.source === "dom" && (
              <div className="aoi-applicability">
                <button
                  className={`secondary-button ${aoi.allSessions ? "active-tool" : ""}`}
                  type="button"
                  onClick={() => onUpdate(aoi.id, { allSessions: !aoi.allSessions })}
                >
                  {aoi.allSessions ? "Enabled for all sessions" : "Enable for all sessions"}
                </button>
                <small>
                  {aoi.allSessions
                    ? "This AOI is forced applicable across the whole study."
                    : "Use this only when you are sure the page and layout are the same across sessions."}
                </small>
              </div>
            )}
            <details>
              <summary>Advanced coordinates</summary>
              <div className="coordinate-grid">
                {(["x", "y", "width", "height"] as const).map((field) => (
                  <label key={field}>
                    {field}
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={aoi[field]}
                      onChange={(event) =>
                        onUpdate(aoi.id, { [field]: Number(event.target.value) || 0 })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>
    </details>
  );
}
