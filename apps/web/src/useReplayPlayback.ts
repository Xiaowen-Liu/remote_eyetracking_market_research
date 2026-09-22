import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

import type { CollectorArtifact } from "./collectorArtifact";
import { isEditableReplayTarget, replayKeyboardAction } from "./replayAccessibility";

export function replayDuration(artifact: CollectorArtifact | null): number {
  if (!artifact) return 0;
  return Math.max(
    0,
    Date.parse(artifact.endedAt ?? artifact.startedAt) - Date.parse(artifact.startedAt),
  );
}

/** Own the replay clock and keyboard transport independently from dashboard rendering. */
export function useReplayPlayback(artifact: CollectorArtifact | null, enabled: boolean) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [timeMs, setTimeState] = useState(0);
  const timeRef = useRef(0);
  const durationMs = replayDuration(artifact);

  const setTimeMs = useCallback((value: SetStateAction<number>) => {
    setTimeState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      timeRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!playing || !artifact) return;
    let previousTick = Date.now();
    const timer = window.setInterval(() => {
      const currentTick = Date.now();
      const elapsed = currentTick - previousTick;
      previousTick = currentTick;
      const next = Math.min(durationMs, timeRef.current + elapsed * speed);
      setTimeMs(next);
      if (next >= durationMs) setPlaying(false);
    }, 50);
    return () => window.clearInterval(timer);
  }, [artifact, durationMs, playing, setTimeMs, speed]);

  useEffect(() => {
    if (!enabled || !artifact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableReplayTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const action = replayKeyboardAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action.type === "toggle") {
        setPlaying((current) => !current);
        return;
      }
      setPlaying(false);
      setTimeMs((current) =>
        action.type === "seek"
          ? Math.min(durationMs, Math.max(0, current + action.deltaMs))
          : action.position === "start"
            ? 0
            : durationMs,
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [artifact, durationMs, enabled, setTimeMs]);

  return {
    durationMs,
    playing,
    setPlaying,
    speed,
    setSpeed,
    timeMs,
    setTimeMs,
  };
}
