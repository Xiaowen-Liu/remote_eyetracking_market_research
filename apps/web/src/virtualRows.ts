export type VirtualRowRange = {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
};

/**
 * Return the inclusive-exclusive row range that should exist in the DOM for a
 * fixed-height virtual table. Overscan keeps keyboard and wheel scrolling from
 * exposing an empty edge between renders.
 */
export function virtualRowRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 44,
  overscan = 8,
): VirtualRowRange {
  if (total <= 0) return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  if (rowHeight <= 0) throw new Error("Virtual row height must be positive.");

  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(rowHeight, viewportHeight);
  const desiredStart = Math.max(0, Math.floor(safeScrollTop / rowHeight) - overscan);
  const maximumStart = Math.max(0, total - Math.ceil(safeViewportHeight / rowHeight) - overscan);
  const start = Math.min(desiredStart, maximumStart);
  const visibleEnd = Math.ceil((safeScrollTop + safeViewportHeight) / rowHeight);
  const end = Math.min(total, visibleEnd + overscan);

  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (total - end) * rowHeight),
  };
}
