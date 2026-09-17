import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, saveResearcherToken } from "./api";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("researcher API authentication", () => {
  beforeEach(() => {
    saveResearcherToken(null);
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("attaches the researcher session to owner-scoped requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    saveResearcherToken("private-researcher-token");

    await api.listProjects();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/projects",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer private-researcher-token",
        }),
      }),
    );
  });

  it("never sends the researcher session to a participant link", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: "public-study" }));
    saveResearcherToken("private-researcher-token");

    await api.resolveParticipantLink("public-capability-token");

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).not.toHaveProperty("Authorization");
  });
});
