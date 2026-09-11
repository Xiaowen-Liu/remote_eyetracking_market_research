import type { CollectorArtifact, CollectorGazeSample } from "./collectorArtifact";

const url = "https://demo.webgaze.test/checkout";
const start = Date.parse("2026-09-11T16:00:00.000Z");

function checkoutSnapshot(step: "plans" | "payment"): string {
  const heading = step === "plans" ? "Choose a plan" : "Secure checkout";
  const selected = step === "plans" ? "Professional" : "Card details";
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <rect width="1280" height="720" fill="#f6f7f2"/><rect width="1280" height="72" fill="#17221d"/>
    <text x="74" y="46" font-family="Arial" font-size="25" font-weight="700" fill="#f7faf5">Acme research checkout</text>
    <text x="100" y="160" font-family="Georgia" font-size="48" fill="#17221d">${heading}</text>
    <text x="100" y="205" font-family="Arial" font-size="20" fill="#657069">A synthetic replay fixture for the public WebGaze portfolio.</text>
    <rect x="100" y="270" width="710" height="260" rx="16" fill="#fff" stroke="#d9ded8"/>
    <text x="142" y="332" font-family="Arial" font-size="20" font-weight="700" fill="#243127">${selected}</text>
    <rect x="142" y="365" width="580" height="44" rx="8" fill="#f4f6f2"/>
    <rect x="142" y="431" width="360" height="44" rx="8" fill="#f4f6f2"/>
    <rect x="862" y="270" width="300" height="190" rx="16" fill="#e6f2d5"/>
    <text x="900" y="334" font-family="Arial" font-size="18" font-weight="700" fill="#34530d">Order summary</text>
    <rect x="900" y="375" width="220" height="14" rx="7" fill="#a7c879"/>
    <rect x="900" y="490" width="260" height="52" rx="10" fill="#203329"/>
    <text x="952" y="524" font-family="Arial" font-size="17" font-weight="700" fill="#f7faf5">Continue</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`;
}

function sampleCluster(centerX: number, centerY: number, count: number, offsetMs: number): CollectorGazeSample[] {
  return Array.from({ length: count }, (_, index) => ({
    x: Math.min(0.98, Math.max(0.02, centerX + ((index % 5) - 2) * 0.012)),
    y: Math.min(0.98, Math.max(0.02, centerY + ((Math.floor(index / 5) % 5) - 2) * 0.012)),
    at: new Date(start + offsetMs + index * 110).toISOString(),
    url,
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0 },
    confidence: 0.86,
  }));
}

export const syntheticCollectorReplay: CollectorArtifact = {
  schemaVersion: "1.0",
  sessionId: "synthetic-replay-demo-v1",
  startedAt: new Date(start).toISOString(),
  endedAt: new Date(start + 14_000).toISOString(),
  captureSnapshots: true,
  events: [
    { type: "page-open", url, at: new Date(start).toISOString() },
    { type: "scroll-settled", url, at: new Date(start + 6_000).toISOString(), detail: { value: { x: 0, y: 0 } } },
    { type: "dom-change", url, at: new Date(start + 10_000).toISOString(), detail: { value: { count: 3 } } },
  ],
  snapshots: [
    { at: new Date(start + 1_000).toISOString(), url, reason: "page-open", dataUrl: checkoutSnapshot("plans"), viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 0 } },
    { at: new Date(start + 8_000).toISOString(), url, reason: "scroll-settled", dataUrl: checkoutSnapshot("payment"), viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 0 } },
  ],
  gazeSamples: [...sampleCluster(0.39, 0.53, 34, 1_200), ...sampleCluster(0.8, 0.7, 29, 8_100)],
  privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: true },
};
