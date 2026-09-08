import type { GazeBatchCreate } from "./api";

export type QueueStore = Pick<Storage, "getItem" | "setItem">;

const queueKey = (sessionId: string) => `webgaze.gaze-queue.v1.${sessionId}`;

export function pendingBatches(store: QueueStore, sessionId: string): GazeBatchCreate[] {
  const stored = store.getItem(queueKey(sessionId));
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as GazeBatchCreate[]) : [];
  } catch {
    return [];
  }
}

export function savePendingBatches(
  store: QueueStore,
  sessionId: string,
  batches: GazeBatchCreate[],
) {
  store.setItem(queueKey(sessionId), JSON.stringify(batches));
}

export function enqueueBatch(
  store: QueueStore,
  sessionId: string,
  batch: GazeBatchCreate,
) {
  savePendingBatches(store, sessionId, [...pendingBatches(store, sessionId), batch]);
}

export async function flushPendingBatches(
  store: QueueStore,
  sessionId: string,
  send: (batch: GazeBatchCreate) => Promise<unknown>,
): Promise<number> {
  const batches = pendingBatches(store, sessionId);
  let sent = 0;
  for (const batch of batches) {
    await send(batch);
    sent += 1;
    savePendingBatches(store, sessionId, batches.slice(sent));
  }
  return sent;
}
