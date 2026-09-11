import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParticipantRunner, participantTokenFromPath } from "./ParticipantRunner";

const apiMocks = vi.hoisted(() => ({
  resolveParticipantLink: vi.fn(),
  createParticipantSession: vi.fn(),
  recordConsent: vi.fn(),
  recordCalibration: vi.fn(),
  startTask: vi.fn(),
  ingestGazeBatch: vi.fn(),
  completeTask: vi.fn(),
  submitSession: vi.fn(),
}));

vi.mock("./api", () => ({
  api: apiMocks,
  ApiClientError: class ApiClientError extends Error {},
}));

describe("participant route parsing", () => {
  it("accepts copied participant links on the web app and API-shaped fallback paths", () => {
    expect(participantTokenFromPath("/participate/demo-token")).toBe("demo-token");
    expect(participantTokenFromPath("/api/v1/participate/demo-token")).toBe("demo-token");
    expect(participantTokenFromPath("/projects")).toBeNull();
  });
});

describe("participant collection journey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    apiMocks.resolveParticipantLink.mockResolvedValue({
      title: "Checkout attention study",
      consent_version: "demo-v1",
      consent_text: "I consent to a synthetic demo.",
      target_origins: ["https://demo.example.com"],
      calibration_policy: { minimum_quality: "variable", allow_retry: true, maximum_attempts: 3 },
      collection_policy: { screenshots_enabled: false, sample_interval_ms: 100 },
      tasks: [
        { position: 1, title: "Find pricing", prompt: "Find pricing.", start_url: "https://demo.example.com/pricing" },
        { position: 2, title: "Begin checkout", prompt: "Begin checkout.", start_url: "https://demo.example.com/pricing" },
      ],
    });
    apiMocks.createParticipantSession.mockResolvedValue({ id: "session-1", access_token: "session-token" });
    apiMocks.recordConsent.mockResolvedValue({});
    apiMocks.recordCalibration.mockResolvedValue({ accepted: true });
    apiMocks.startTask
      .mockResolvedValueOnce({ id: "run-1" })
      .mockResolvedValueOnce({ id: "run-2" });
    apiMocks.ingestGazeBatch.mockResolvedValue({});
    apiMocks.completeTask.mockResolvedValue({});
    apiMocks.submitSession.mockResolvedValue({
      analysis_job: { id: "job-12345678", algorithm_version: "gaze-task-metrics-v1" },
    });
  });

  it("takes a consented participant through calibration, tasks, batch upload, and analysis submission", async () => {
    const user = userEvent.setup();
    render(<ParticipantRunner token="journey-token" />);

    expect(await screen.findByRole("heading", { name: "Checkout attention study" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    await user.click(screen.getByRole("button", { name: "Record synthetic calibration" }));

    await user.click(screen.getByRole("button", { name: "Start task 1" }));
    await user.click(screen.getByRole("button", { name: "Record synthetic gaze sample" }));
    await waitFor(() => expect(apiMocks.ingestGazeBatch).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Finish task" }));

    await user.click(screen.getByRole("button", { name: "Start task 2" }));
    await user.click(screen.getByRole("button", { name: "Record synthetic gaze sample" }));
    await waitFor(() => expect(apiMocks.ingestGazeBatch).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Finish task" }));

    expect(await screen.findByRole("heading", { name: "Analysis queued" })).toBeInTheDocument();
    expect(apiMocks.recordConsent).toHaveBeenCalledWith("session-1", "session-token", "demo-v1");
    expect(apiMocks.completeTask).toHaveBeenCalledTimes(2);
    expect(apiMocks.submitSession).toHaveBeenCalledWith("session-1", "session-token");
  });
});
