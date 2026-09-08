import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const apiMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  listStudies: vi.fn(),
  getDraft: vi.fn(),
  getParticipantLink: vi.fn(),
  createStudy: vi.fn(),
  replaceDraft: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("./api", () => ({
  api: apiMocks,
  ApiClientError: class ApiClientError extends Error {},
}));

describe("Study Builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    apiMocks.listProjects.mockResolvedValue({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          owner_id: "00000000-0000-4000-8000-000000000001",
          name: "Checkout UX research",
          research_question: null,
          status: "active",
          created_at: "2026-09-07T00:00:00Z",
          updated_at: "2026-09-07T00:00:00Z",
        },
      ],
      total: 1,
    });
    apiMocks.listStudies.mockResolvedValue({ items: [], total: 0 });
    apiMocks.getParticipantLink.mockResolvedValue({
      participant_url: "/participate/demo-link",
    });
  });

  it("adds tasks while preserving contiguous task numbering", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Checkout UX research");
    expect(screen.getByText("1 / 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add task" }));

    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Task 2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("returns to a project dashboard from the Projects breadcrumb", async () => {
    const user = userEvent.setup();
    apiMocks.listProjects.mockResolvedValue({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          owner_id: "00000000-0000-4000-8000-000000000001",
          name: "Checkout UX research",
          research_question: null,
          status: "active",
          created_at: "2026-09-07T00:00:00Z",
          updated_at: "2026-09-07T00:00:00Z",
        },
        {
          id: "00000000-0000-4000-8000-000000000011",
          owner_id: "00000000-0000-4000-8000-000000000001",
          name: "Navigation research",
          research_question: null,
          status: "active",
          created_at: "2026-09-07T00:00:00Z",
          updated_at: "2026-09-07T00:00:00Z",
        },
      ],
      total: 2,
    });
    render(<App />);

    await screen.findByText("Checkout UX research");
    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("Organize studies, participant protocols, and analysis work in one place.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open project" })).toHaveLength(2);
  });

  it("creates a named project from the dashboard", async () => {
    const user = userEvent.setup();
    apiMocks.createProject.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000012",
      owner_id: "00000000-0000-4000-8000-000000000001",
      name: "Accessibility follow-up",
      research_question: "How do people visually navigate checkout?",
      status: "active",
      created_at: "2026-09-07T00:00:00Z",
      updated_at: "2026-09-07T00:00:00Z",
    });
    render(<App />);

    await screen.findByText("Checkout UX research");
    await user.click(screen.getByRole("button", { name: "Projects" }));
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Project name"), "Accessibility follow-up");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(apiMocks.createProject).toHaveBeenCalledWith("Accessibility follow-up");
    });
  });

  it("keeps a published version read-only until a revision is created", async () => {
    const user = userEvent.setup();
    apiMocks.listStudies.mockResolvedValue({
      items: [{ id: "00000000-0000-4000-8000-000000000020" }],
      total: 1,
    });
    apiMocks.getDraft.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000020",
      project_id: "00000000-0000-4000-8000-000000000010",
      lifecycle: "published",
      draft_revision: 1,
      current_published_version: 1,
      created_at: "2026-09-07T00:00:00Z",
      updated_at: "2026-09-07T00:00:00Z",
      title: "Published checkout study",
      description: "Published research protocol",
      consent_version: "demo-v1",
      consent_text: "I consent to this synthetic study.",
      target_origins: ["https://demo.example.com/"],
      calibration_policy: {
        minimum_quality: "variable",
        allow_retry: true,
        maximum_attempts: 3,
      },
      collection_policy: { screenshots_enabled: false, sample_interval_ms: 100 },
      retention_days: 30,
      tasks: [
        {
          position: 1,
          title: "Find pricing",
          prompt: "Find pricing.",
          start_url: "https://demo.example.com/pricing",
          success_url_pattern: null,
          time_limit_ms: 120000,
          areas_of_interest: [],
        },
      ],
    });

    render(<App />);

    expect(await screen.findByText("Published · v1")).toBeInTheDocument();
    expect(screen.getByLabelText("Study title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Add task" })).toHaveAttribute(
      "title",
      "Edit study to add tasks",
    );
    expect(screen.getByText("This version is live. Select Edit study to change its tasks.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish study" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy participant link" }));
    expect(screen.getByRole("button", { name: "✓ Link copied" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit study" }));

    expect(screen.getByLabelText("Study title")).toBeEnabled();
    expect(screen.getByText("Editing study")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish changes" })).toBeDisabled();
  });
});
