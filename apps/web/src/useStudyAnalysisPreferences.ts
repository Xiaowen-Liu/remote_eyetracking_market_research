import { useCallback, useState } from "react";

export type ReplayAoi = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source: "manual" | "dom";
  sessionIds?: string[];
  allSessions?: boolean;
  canonicalKey?: string;
  sourcePath?: string;
};

export type SessionPreference = { name?: string; hidden?: boolean };

function readStoredAois(studyId: string): ReplayAoi[] {
  try {
    const stored = JSON.parse(localStorage.getItem(`webgaze.aois.${studyId}`) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function readStoredSessionPreferences(studyId: string): Record<string, SessionPreference> {
  try {
    const stored = JSON.parse(localStorage.getItem(`webgaze.sessions.${studyId}`) ?? "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

/** Own study-scoped analysis preferences and their browser persistence boundary. */
export function useStudyAnalysisPreferences(studyId: string) {
  const [replayAois, setReplayAois] = useState<ReplayAoi[]>(() => readStoredAois(studyId));
  const [sessionPreferences, setSessionPreferences] = useState<Record<string, SessionPreference>>(
    () => readStoredSessionPreferences(studyId),
  );

  const persistAois = useCallback(
    (next: ReplayAoi[]) => {
      setReplayAois(next);
      localStorage.setItem(`webgaze.aois.${studyId}`, JSON.stringify(next));
    },
    [studyId],
  );

  const saveSessionPreference = useCallback(
    (sessionId: string, preference: SessionPreference) => {
      setSessionPreferences((current) => {
        const next = {
          ...current,
          [sessionId]: { ...current[sessionId], ...preference },
        };
        localStorage.setItem(`webgaze.sessions.${studyId}`, JSON.stringify(next));
        return next;
      });
    },
    [studyId],
  );

  return { replayAois, persistAois, sessionPreferences, saveSessionPreference };
}
