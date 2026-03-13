/**
 * Main-thread proxy for NER inference.
 *
 * All Transformers.js work runs in a dedicated Web Worker (ner-worker.ts),
 * keeping the main thread free during the ~1–5 s inference window.
 *
 * Public API is identical to the pre-worker implementation:
 *   detectPiiNer / preloadNerModel / releaseNerModel
 *
 * Internal protocol: see src/workers/ner-worker-protocol.ts
 */

import type { PiiEntity, ProgressEvent } from "../types.js";
import type {
  NerWorkerRequest,
  NerWorkerResponse,
} from "../workers/ner-worker-protocol.js";

// ── Worker singleton ──────────────────────────────────────────────────────────

// Allows tests to inject a mock worker factory without loading an actual bundle.
type WorkerFactory = () => Worker;

// Default factory — uses Vite's `?worker&inline` to embed the worker in the
// library bundle so consumers don't need to resolve a separate file.
let workerFactory: WorkerFactory = () =>
  new Worker(new URL("../workers/ner-worker.ts", import.meta.url), {
    type: "module",
  });

/** Override the worker factory. Exported for testing only. */
export function _setWorkerFactory(factory: WorkerFactory): void {
  // Reset the singleton so the new factory takes effect on next use.
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  workerFactory = factory;
}

let workerInstance: Worker | null = null;
let requestCounter = 0;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = workerFactory();

    workerInstance.onmessage = (event: MessageEvent<NerWorkerResponse>) => {
      const msg = event.data;
      const pending = pendingRequests.get(msg.id);
      if (!pending) return; // response for unknown/cancelled request

      if (msg.type === "PROGRESS") {
        pending.onProgress?.(msg.event);
      } else if (msg.type === "RESULT") {
        pendingRequests.delete(msg.id);
        pending.resolve(msg.entities);
      } else if (msg.type === "DONE") {
        pendingRequests.delete(msg.id);
        pending.resolve(undefined as any);
      } else if (msg.type === "ERROR") {
        pendingRequests.delete(msg.id);
        pending.reject(new Error(msg.message));
      }
    };

    workerInstance.onerror = (err) => {
      // Reject all pending requests on worker crash
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error(`NER worker crashed: ${err.message}`));
        pendingRequests.delete(id);
      }
      workerInstance = null;
    };
  }
  return workerInstance;
}

// ── Pending request registry ──────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  onProgress?: (event: ProgressEvent) => void;
}

const pendingRequests = new Map<number, PendingRequest>();

function sendRequest<T>(
  msg: NerWorkerRequest,
  onProgress?: (event: ProgressEvent) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(msg.id, { resolve, reject, onProgress });
    getWorker().postMessage(msg);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run NER-based PII detection in a Web Worker.
 *
 * Returns detected PiiEntity items. Progress events fire on the main thread
 * via the optional onProgress callback.
 */
export async function detectPiiNer(
  text: string,
  modelId: string,
  minConfidence: number = 0.7,
  onProgress?: (event: ProgressEvent) => void,
): Promise<PiiEntity[]> {
  const id = ++requestCounter;
  return sendRequest<PiiEntity[]>(
    { type: "DETECT", id, text, modelId, minConfidence },
    onProgress,
  );
}

/**
 * Pre-load the NER model in the worker without running inference.
 * Call this to warm up the cache ahead of time.
 */
export async function preloadNerModel(
  modelId: string,
  onProgress?: (event: ProgressEvent) => void,
): Promise<void> {
  const id = ++requestCounter;
  return sendRequest<void>({ type: "PRELOAD", id, modelId }, onProgress);
}

/**
 * Release the NER model from worker memory and terminate the worker.
 *
 * After this call the next detectPiiNer / preloadNerModel will spawn a fresh
 * worker and re-download the model.
 */
export async function releaseNerModel(): Promise<void> {
  if (!workerInstance) return;
  const id = ++requestCounter;
  await sendRequest<void>({ type: "RELEASE", id });
  workerInstance.terminate();
  workerInstance = null;
}
