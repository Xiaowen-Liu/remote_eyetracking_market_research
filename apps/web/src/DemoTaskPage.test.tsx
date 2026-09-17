import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";

describe("hosted demo task", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/demo/pricing");
  });

  it("renders a usable pricing target without bootstrapping the researcher workspace", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Research tools that grow with your team" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose Team" })).toHaveAttribute(
      "href",
      "/demo/checkout",
    );
  });
});
