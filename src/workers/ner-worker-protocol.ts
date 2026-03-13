/**
 * Typed message protocol for the NER Web Worker bridge.
 *
 * Shared by:
 *  - ner-worker.ts  (worker side — receives requests, sends responses)
 *  - pii-ner.ts     (main thread side — sends requests, receives responses)
 */

import type { PiiEntity, ProgressEvent } from "../types.js";

// ── Requests (main thread → worker) ──────────────────────────────────────────

export type NerWorkerRequest =
  | {
      type: "DETECT";
      id: number;
      text: string;
      modelId: string;
      minConfidence: number;
    }
  | { type: "PRELOAD"; id: number; modelId: string }
  | { type: "RELEASE"; id: number };

// ── Responses (worker → main thread) ─────────────────────────────────────────

export type NerWorkerResponse =
  | { type: "RESULT"; id: number; entities: PiiEntity[] }
  | { type: "PROGRESS"; id: number; event: ProgressEvent }
  | { type: "DONE"; id: number }
  | { type: "ERROR"; id: number; message: string };
