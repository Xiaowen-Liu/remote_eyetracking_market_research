import { useState } from "react";

import { proposalWasAdopted, urlPath } from "./aoiProposalMatching";
import { domProposalStates, type CollectorArtifact } from "./collectorArtifact";
import type { ReplayAoi } from "./useStudyAnalysisPreferences";

export function DomProposalsPanel({
  artifact,
  aois,
  onAdd,
  emptyReason,
}: {
  artifact: CollectorArtifact | null;
  aois: ReplayAoi[];
  onAdd: (additions: ReplayAoi[]) => void;
  emptyReason?: string;
}) {
  const [stateIndex, setStateIndex] = useState(0);
  const [proposalIndex, setProposalIndex] = useState(0);
  const states = artifact ? domProposalStates(artifact) : [];
  const state = states[stateIndex] ?? null;
  const selectedProposal = state?.proposals[proposalIndex] ?? null;
  const newProposals =
    state?.proposals
      .filter((proposal) => !aois.some((aoi) => proposalWasAdopted(aoi, proposal)))
      .map((proposal) => ({
        ...proposal,
        source: "dom" as const,
        sessionIds: artifact ? [artifact.sessionId] : [],
        sourcePath: urlPath(state.url) ?? undefined,
      })) ?? [];
  const snapshotIndex =
    artifact && state
      ? artifact.snapshots.reduce(
          (best, snapshot, index) =>
            Math.abs(Date.parse(snapshot.at) - Date.parse(state.at)) <
            Math.abs(
              Date.parse(artifact.snapshots[best]?.at ?? artifact.startedAt) - Date.parse(state.at),
            )
              ? index
              : best,
          0,
        )
      : 0;

  if (!states.length) {
    return (
      <section className="empty-results dashboard-empty">
        <p className="eyebrow">Automatic AOI review</p>
        <h2>DOM proposals</h2>
        <p>
          {artifact
            ? "This replay context has no recorded DOM candidates. Screenshots are not used to reconstruct missing DOM proposals; reload the current collector build before recording a new session."
            : (emptyReason ??
              "Select a replay-ready session or import an extension artifact to review recorded DOM candidates.")}
        </p>
      </section>
    );
  }
  if (!artifact || !state) return null;

  function addOne(proposal: NonNullable<typeof selectedProposal>) {
    onAdd([
      {
        ...proposal,
        id: crypto.randomUUID(),
        source: "dom",
        sessionIds: [artifact!.sessionId],
        sourcePath: urlPath(state!.url) ?? undefined,
      },
    ]);
  }

  return (
    <section className="dom-proposals-panel">
      <div className="dom-proposals-header">
        <div>
          <p className="eyebrow">Automatic AOI review</p>
          <h2>DOM Proposals</h2>
          <p>Review regions captured from the live DOM at recording time.</p>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!newProposals.length}
          onClick={() =>
            onAdd(newProposals.map((proposal) => ({ ...proposal, id: crypto.randomUUID() })))
          }
        >
          {newProposals.length ? `Add ${newProposals.length} New` : "All Added"}
        </button>
      </div>
      <div className="proposal-toolbar">
        <label>
          Screen state
          <select
            value={stateIndex}
            onChange={(event) => {
              setStateIndex(Number(event.target.value));
              setProposalIndex(0);
            }}
          >
            {states.map((candidate, index) => (
              <option value={index} key={`${candidate.at}-${index}`}>
                {new Date(candidate.at).toLocaleTimeString()} · {candidate.trigger} ·{" "}
                {candidate.proposals.length}
              </option>
            ))}
          </select>
        </label>
        <span className="context-chip">{state.proposals.length} on screen</span>
        <span className="context-chip">{newProposals.length} new</span>
        <span className="context-chip">{state.proposals.length - newProposals.length} added</span>
      </div>
      <div className="proposal-grid">
        <section>
          <div className="snapshot-title">
            <h3>Screen Preview</h3>
            <span>
              {new Date(state.at).toLocaleTimeString()} · {state.trigger}
            </span>
          </div>
          {artifact.snapshots[snapshotIndex] ? (
            <div className="proposal-preview">
              <img src={artifact.snapshots[snapshotIndex].dataUrl} alt="Recorded page state" />
              {state.proposals.map((proposal, index) => (
                <button
                  type="button"
                  key={`${proposal.label}-${index}`}
                  className={proposalIndex === index ? "selected" : ""}
                  aria-label={`Select ${proposal.label}`}
                  onClick={() => setProposalIndex(index)}
                  style={{
                    left: `${Math.max(0, proposal.x) * 100}%`,
                    top: `${Math.max(0, proposal.y) * 100}%`,
                    width: `${Math.min(1, proposal.width) * 100}%`,
                    height: `${Math.min(1, proposal.height) * 100}%`,
                  }}
                >
                  {proposalIndex === index ? "Selected" : index + 1}
                </button>
              ))}
            </div>
          ) : (
            <p>
              This screen state has DOM proposals, but no matching screenshot preview was saved.
            </p>
          )}
        </section>
        <aside>
          <div className="proposal-inspector">
            <p className="eyebrow">Selected candidate</p>
            <h3>{selectedProposal?.label ?? "No proposal selected"}</h3>
            {selectedProposal && (
              <>
                <span>
                  {selectedProposal.tag}
                  {selectedProposal.role ? ` · ${selectedProposal.role}` : ""}
                </span>
                <p>
                  {Math.round(selectedProposal.width * 100)}% ×{" "}
                  {Math.round(selectedProposal.height * 100)}% of viewport
                </p>
                <button
                  className="primary-button"
                  type="button"
                  disabled={aois.some((aoi) => proposalWasAdopted(aoi, selectedProposal))}
                  onClick={() => addOne(selectedProposal)}
                >
                  {aois.some((aoi) => proposalWasAdopted(aoi, selectedProposal))
                    ? "Added"
                    : "Add to Study"}
                </button>
              </>
            )}
          </div>
          <ol className="proposal-list">
            {state.proposals.map((proposal, index) => {
              const added = aois.some((aoi) => proposalWasAdopted(aoi, proposal));
              return (
                <li
                  className={proposalIndex === index ? "selected" : ""}
                  key={`${proposal.label}-${index}`}
                >
                  <button type="button" onClick={() => setProposalIndex(index)}>
                    <b>{index + 1}</b>
                    <span>
                      <strong>{proposal.label}</strong>
                      <small>
                        {proposal.tag} · {Math.round(proposal.width * proposal.height * 100)}%
                        viewport
                      </small>
                    </span>
                    <em>{added ? "Added" : "Review"}</em>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </section>
  );
}
