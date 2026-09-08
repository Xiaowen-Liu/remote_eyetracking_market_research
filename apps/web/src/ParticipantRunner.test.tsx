import { describe, expect, it } from "vitest";

import { participantTokenFromPath } from "./ParticipantRunner";

describe("participant route parsing", () => {
  it("accepts copied participant links on the web app and API-shaped fallback paths", () => {
    expect(participantTokenFromPath("/participate/demo-token")).toBe("demo-token");
    expect(participantTokenFromPath("/api/v1/participate/demo-token")).toBe("demo-token");
    expect(participantTokenFromPath("/projects")).toBeNull();
  });
});
