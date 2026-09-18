import type {
  CollectorArtifact,
  CollectorGazeSample,
  CollectorSnapshot,
} from "./collectorArtifact";

export type ReplayCoordinateMode = "viewport" | "document";
export type ReplayScrollSegment = {
  id: string;
  label: string;
  scroll: { x: number; y: number };
  samples: CollectorGazeSample[];
};

export type DocumentExtent = { width: number; height: number };

const scrollDistance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.hypot(left.x - right.x, left.y - right.y);

export function detectScrollSegments(
  samples: CollectorGazeSample[],
  tolerance = 24,
): ReplayScrollSegment[] {
  const segments: ReplayScrollSegment[] = [];
  for (const sample of samples) {
    const scroll = sample.scroll ?? { x: 0, y: 0 };
    const current = segments.at(-1);
    if (!current || scrollDistance(current.scroll, scroll) > tolerance) {
      segments.push({
        id: `scroll-${segments.length + 1}`,
        label: `Segment ${segments.length + 1} · x ${Math.round(scroll.x)}, y ${Math.round(scroll.y)}`,
        scroll,
        samples: [sample],
      });
    } else {
      current.samples.push(sample);
      const count = current.samples.length;
      current.scroll = {
        x: current.scroll.x + (scroll.x - current.scroll.x) / count,
        y: current.scroll.y + (scroll.y - current.scroll.y) / count,
      };
    }
  }
  return segments;
}

export function inferDocumentExtent(artifact: CollectorArtifact): DocumentExtent {
  const contexts = [
    ...(artifact.gazeSamples ?? []).map((sample) => ({
      viewport: sample.viewport,
      scroll: sample.scroll,
    })),
    ...artifact.snapshots.map((snapshot) => ({
      viewport: snapshot.viewport,
      scroll: snapshot.scroll,
    })),
  ];
  return contexts.reduce<DocumentExtent>(
    (extent, context) => ({
      width: Math.max(extent.width, (context.scroll?.x ?? 0) + (context.viewport?.width ?? 1)),
      height: Math.max(extent.height, (context.scroll?.y ?? 0) + (context.viewport?.height ?? 1)),
    }),
    { width: 1, height: 1 },
  );
}

export function projectReplaySample(
  sample: CollectorGazeSample,
  mode: ReplayCoordinateMode,
  extent: DocumentExtent,
  fallbackSnapshot?: CollectorSnapshot,
): CollectorGazeSample {
  if (mode === "viewport") return sample;
  const viewport = sample.viewport ??
    fallbackSnapshot?.viewport ?? { width: extent.width, height: extent.height };
  const scroll = sample.scroll ?? fallbackSnapshot?.scroll ?? { x: 0, y: 0 };
  return {
    ...sample,
    x: Math.min(1, Math.max(0, (scroll.x + sample.x * viewport.width) / extent.width)),
    y: Math.min(1, Math.max(0, (scroll.y + sample.y * viewport.height) / extent.height)),
  };
}

export function snapshotDocumentStyle(snapshot: CollectorSnapshot, extent: DocumentExtent) {
  const viewport = snapshot.viewport ?? extent;
  const scroll = snapshot.scroll ?? { x: 0, y: 0 };
  const cropTop = scroll.y > 0 ? 4 : 0;
  const cropRight = scroll.x + viewport.width < extent.width ? 4 : 0;
  const cropBottom = scroll.y + viewport.height < extent.height ? 4 : 0;
  const cropLeft = scroll.x > 0 ? 4 : 0;
  return {
    left: `${(scroll.x / extent.width) * 100}%`,
    top: `${(scroll.y / extent.height) * 100}%`,
    width: `${(viewport.width / extent.width) * 100}%`,
    height: `${(viewport.height / extent.height) * 100}%`,
    clipPath: `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`,
  };
}

export function insertReplaySnapshot(
  artifact: CollectorArtifact,
  dataUrl: string,
  replayTimeMs: number,
): CollectorArtifact {
  if (!dataUrl.startsWith("data:image/"))
    throw new Error("Choose an image file to insert into replay.");
  const at = new Date(Date.parse(artifact.startedAt) + Math.max(0, replayTimeMs)).toISOString();
  const nearest = [...artifact.snapshots].sort(
    (left, right) =>
      Math.abs(Date.parse(left.at) - Date.parse(at)) -
      Math.abs(Date.parse(right.at) - Date.parse(at)),
  )[0];
  const snapshot: CollectorSnapshot = {
    at,
    dataUrl,
    reason: "researcher-inserted",
    url: nearest?.url,
    viewport: nearest?.viewport,
    scroll: nearest?.scroll,
  };
  return {
    ...artifact,
    snapshots: [...artifact.snapshots, snapshot].sort(
      (left, right) => Date.parse(left.at) - Date.parse(right.at),
    ),
  };
}
