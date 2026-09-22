import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useStudyAnalysisPreferences } from "./useStudyAnalysisPreferences";

describe("useStudyAnalysisPreferences", () => {
  beforeEach(() => localStorage.clear());

  it("keeps AOIs and session display preferences scoped to one study", () => {
    const { result, unmount } = renderHook(() => useStudyAnalysisPreferences("study-a"));
    act(() => {
      result.current.persistAois([
        {
          id: "aoi-1",
          label: "Checkout",
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.2,
          source: "manual",
        },
      ]);
      result.current.saveSessionPreference("session-1", { name: "First participant" });
    });
    expect(JSON.parse(localStorage.getItem("webgaze.aois.study-a") ?? "[]")).toHaveLength(1);
    expect(result.current.sessionPreferences["session-1"].name).toBe("First participant");
    unmount();

    const other = renderHook(() => useStudyAnalysisPreferences("study-b"));
    expect(other.result.current.replayAois).toEqual([]);
    expect(other.result.current.sessionPreferences).toEqual({});
  });
});
