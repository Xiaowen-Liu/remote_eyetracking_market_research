import { describe, expect, it } from "vitest";
import { isEditableReplayTarget, replayKeyboardAction } from "./replayAccessibility";

describe("replay keyboard accessibility", () => {
  it("maps playback, seek, and boundary shortcuts", () => {
    expect(replayKeyboardAction(" ")).toEqual({ type: "toggle" });
    expect(replayKeyboardAction("K")).toEqual({ type: "toggle" });
    expect(replayKeyboardAction("ArrowLeft")).toEqual({ type: "seek", deltaMs: -5_000 });
    expect(replayKeyboardAction("l")).toEqual({ type: "seek", deltaMs: 5_000 });
    expect(replayKeyboardAction("Home")).toEqual({ type: "boundary", position: "start" });
    expect(replayKeyboardAction("End")).toEqual({ type: "boundary", position: "end" });
    expect(replayKeyboardAction("Escape")).toBeNull();
  });

  it("does not claim shortcuts while the researcher is editing a control", () => {
    expect(isEditableReplayTarget(document.createElement("input"))).toBe(true);
    expect(isEditableReplayTarget(document.createElement("select"))).toBe(true);
    expect(isEditableReplayTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableReplayTarget(document.createElement("button"))).toBe(false);
  });
});
