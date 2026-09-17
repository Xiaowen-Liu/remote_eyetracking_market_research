export type ReplayKeyboardAction =
  | { type: "toggle" }
  | { type: "seek"; deltaMs: number }
  | { type: "boundary"; position: "start" | "end" };

export function replayKeyboardAction(key: string): ReplayKeyboardAction | null {
  if (key === " " || key === "k" || key === "K") return { type: "toggle" };
  if (key === "ArrowLeft" || key === "j" || key === "J") return { type: "seek", deltaMs: -5_000 };
  if (key === "ArrowRight" || key === "l" || key === "L") return { type: "seek", deltaMs: 5_000 };
  if (key === "Home") return { type: "boundary", position: "start" };
  if (key === "End") return { type: "boundary", position: "end" };
  return null;
}

export function isEditableReplayTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
