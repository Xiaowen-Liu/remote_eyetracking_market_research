import type { CollectorArtifact } from "./collectorArtifact";

const databaseName = "webgaze-analysis-workspace";
const storeName = "collector-sessions";

type StoredArtifact = { key: string; studyId: string; artifact: CollectorArtifact; updatedAt: string };

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: "key" });
      store.createIndex("studyId", "studyId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the local analysis archive."));
  });
}

function transactionResult<T>(request: IDBRequest<T>, transaction: IDBTransaction) {
  return new Promise<T>((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error("Local analysis storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local analysis storage was aborted."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local analysis storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local analysis storage was aborted."));
  });
}

export async function listStoredArtifacts(studyId: string) {
  const db = await database();
  try {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).index("studyId").getAll(studyId);
    const rows = await transactionResult(request, transaction) as StoredArtifact[];
    return rows.map((row) => row.artifact).sort((left, right) => Date.parse(right.endedAt ?? right.startedAt) - Date.parse(left.endedAt ?? left.startedAt));
  } finally {
    db.close();
  }
}

export async function storeArtifacts(studyId: string, artifacts: CollectorArtifact[]) {
  const db = await database();
  try {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    artifacts.forEach((artifact) => store.put({ key: `${studyId}:${artifact.sessionId}`, studyId, artifact, updatedAt: new Date().toISOString() } satisfies StoredArtifact));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function deleteStoredArtifact(studyId: string, sessionId: string) {
  const db = await database();
  try {
    const transaction = db.transaction(storeName, "readwrite");
    await transactionResult(transaction.objectStore(storeName).delete(`${studyId}:${sessionId}`), transaction);
  } finally {
    db.close();
  }
}

export async function clearStoredArtifacts(studyId: string) {
  const artifacts = await listStoredArtifacts(studyId);
  await Promise.all(artifacts.map((artifact) => deleteStoredArtifact(studyId, artifact.sessionId)));
}
