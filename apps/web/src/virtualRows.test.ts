import { describe, expect, it } from "vitest";
import { virtualRowRange } from "./virtualRows";

describe("virtual row range", () => {
  it("renders only the first viewport and overscan at the top", () => {
    expect(virtualRowRange(10_000, 0, 440, 44, 2)).toEqual({
      start: 0,
      end: 12,
      paddingTop: 0,
      paddingBottom: 439_472,
    });
  });

  it("preserves the full scroll height while selecting middle rows", () => {
    const range = virtualRowRange(10_000, 220_000, 440, 44, 4);
    expect(range).toEqual({
      start: 4_996,
      end: 5_014,
      paddingTop: 219_824,
      paddingBottom: 219_384,
    });
    expect(range.paddingTop + (range.end - range.start) * 44 + range.paddingBottom).toBe(440_000);
  });

  it("clamps the final viewport and handles an empty table", () => {
    expect(virtualRowRange(20, 10_000, 440, 44, 3)).toEqual({
      start: 7,
      end: 20,
      paddingTop: 308,
      paddingBottom: 0,
    });
    expect(virtualRowRange(0, 0, 440)).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });
});
