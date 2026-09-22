import type { DomProposal } from "./collectorArtifact";
import type { ReplayAoi } from "./useStudyAnalysisPreferences";

export function urlPath(value?: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

export function proposalWasAdopted(
  aoi: ReplayAoi,
  proposal: Pick<DomProposal, "label" | "x" | "y" | "width" | "height">,
): boolean {
  const sameGeometry =
    Math.abs(aoi.x - proposal.x) < 0.04 &&
    Math.abs(aoi.y - proposal.y) < 0.04 &&
    Math.abs(aoi.width - proposal.width) < 0.04 &&
    Math.abs(aoi.height - proposal.height) < 0.04;
  return (
    aoi.label.localeCompare(proposal.label, undefined, { sensitivity: "accent" }) === 0 &&
    sameGeometry
  );
}
