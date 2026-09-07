import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const apiMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  listStudies: vi.fn(),
  getDraft: vi.fn(),
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
});
