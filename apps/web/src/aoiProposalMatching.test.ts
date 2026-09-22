import { describe, expect, it } from "vitest";

import { proposalWasAdopted, urlPath } from "./aoiProposalMatching";
import type { ReplayAoi } from "./useStudyAnalysisPreferences";

const aoi: ReplayAoi = {
  id: "aoi-1",
  label: "Checkout button",
  x: 0.2,
  y: 0.3,
  width: 0.2,
  height: 0.1,
  source: "dom",
};

describe("AOI proposal matching", () => {
  it("requires the same label and nearby geometry", () => {
    expect(proposalWasAdopted(aoi, { ...aoi, x: 0.22 })).toBe(true);
    expect(proposalWasAdopted(aoi, { ...aoi, x: 0.25 })).toBe(false);
    expect(proposalWasAdopted(aoi, { ...aoi, label: "Different" })).toBe(false);
  });

  it("extracts a stable path and rejects malformed URLs", () => {
    expect(urlPath("https://example.com/checkout?step=2")).toBe("/checkout");
    expect(urlPath("not a url")).toBeNull();
  });
});
