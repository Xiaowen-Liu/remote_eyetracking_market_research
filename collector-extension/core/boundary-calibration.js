export function createBoundaryPath(width, height, inset = 28) {
  return [
    { x: inset, y: inset },
    { x: width - inset, y: inset },
    { x: width - inset, y: height - inset },
    { x: inset, y: height - inset },
    { x: inset, y: inset },
  ];
}

export function observeSegment(start, end, point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const rawProgress = lengthSquared === 0 ? 0 : ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const progress = Math.max(0, Math.min(1, rawProgress));
  const projected = { x: start.x + dx * progress, y: start.y + dy * progress };
  return {
    progress: rawProgress,
    distance: Math.hypot(point.x - projected.x, point.y - projected.y),
    distanceToEnd: Math.hypot(point.x - end.x, point.y - end.y),
  };
}

export function pointerSpeed(previous, current, elapsedMs) {
  if (!previous || elapsedMs <= 0) return 0;
  return Math.hypot(current.x - previous.x, current.y - previous.y) / elapsedMs;
}

export function hasArrived(observation, arrivalRadius = 52, railTolerance = 56) {
  return observation.distanceToEnd <= arrivalRadius || (observation.progress >= 1 && observation.distance <= railTolerance);
}
