/**
 * NER Web Worker — runs Transformers.js token-classification off the main thread.
 *
 * Receives typed NerWorkerRequest messages, runs the pipeline, and posts
 * NerWorkerResponse messages back. All Transformers.js inference (model
 * loading, tokenization, ONNX inference, aggregation) happens in this worker
 * context, keeping the main thread free for rendering.
 *
 * Message protocol: see ner-worker-protocol.ts
 */

import {
  processRawEntities,
  type RawNerToken,
} from "../pipeline/ner-aggregation.js";
import type { NerWorkerRequest, NerWorkerResponse } from "./ner-worker-protocol.js";

// ── Pipeline singleton (worker-local) ─────────────────────────────────────────

let pipelineInstance: any = null;
let pipelineModelId: string | null = null;
let envConfigured = false;

/** Reset singleton state. Exported for testing only — not part of public API. */
export function _resetWorkerState(): void {
  pipelineInstance = null;
  pipelineModelId = null;
  envConfigured = false;
}

async function loadPipeline(
  modelId: string,
  postMessage: (msg: NerWorkerResponse) => void,
  requestId: number,
): Promise<any> {
  if (pipelineInstance && pipelineModelId === modelId) {
    return pipelineInstance;
  }

  postMessage({
    type: "PROGRESS",
    id: requestId,
    event: { phase: "loading", progress: 0, message: "Loading PII detection model..." },
  });

  const { pipeline, env } = await import("@xenova/transformers");

  if (!envConfigured) {
    env.allowLocalModels = false;
    envConfigured = true;
  }

  const isMobile =
    typeof navigator !== "undefined" &&
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  pipelineInstance = await pipeline("token-classification", modelId, {
    progress_callback: (p: any) => {
      if (p.status === "progress" && p.total) {
        postMessage({
          type: "PROGRESS",
          id: requestId,
          event: {
            phase: "loading",
            progress: p.loaded / p.total,
            message: `Downloading model: ${Math.round((p.loaded / p.total) * 100)}%`,
          },
        });
      }
    },
    device: isMobile ? "wasm" : "auto",
    dtype: "q4",
  } as any);

  pipelineModelId = modelId;

  postMessage({
    type: "PROGRESS",
    id: requestId,
    event: { phase: "loading", progress: 1, message: "Model loaded." },
  });

  return pipelineInstance;
}

// ── Message dispatcher ────────────────────────────────────────────────────────

/**
 * Handle a single worker request. Exported for unit testing without a real Worker.
 * In production the self.onmessage handler at the bottom calls this.
 */
export async function handleWorkerMessage(
  req: NerWorkerRequest,
  postMessage: (msg: NerWorkerResponse) => void,
): Promise<void> {
  switch (req.type) {
    case "PRELOAD": {
      try {
        await loadPipeline(req.modelId, postMessage, req.id);
        postMessage({ type: "DONE", id: req.id });
      } catch (err) {
        postMessage({
          type: "ERROR",
          id: req.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "DETECT": {
      try {
        const pipeline = await loadPipeline(req.modelId, postMessage, req.id);

        postMessage({
          type: "PROGRESS",
          id: req.id,
          event: { phase: "detecting", progress: 0, message: "Running PII detection..." },
        });

        // Try aggregation strategies: first → simple → raw BIO
        let rawEntities: RawNerToken[];
        try {
          rawEntities = await pipeline(req.text, { aggregation_strategy: "first" });
        } catch {
          try {
            rawEntities = await pipeline(req.text, { aggregation_strategy: "simple" });
          } catch {
            rawEntities = await pipeline(req.text);
          }
        }

        postMessage({
          type: "PROGRESS",
          id: req.id,
          event: { phase: "detecting", progress: 1, message: "PII detection complete." },
        });

        const entities = processRawEntities(rawEntities, req.text, req.minConfidence);
        postMessage({ type: "RESULT", id: req.id, entities });
      } catch (err) {
        postMessage({
          type: "ERROR",
          id: req.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "RELEASE": {
      if (pipelineInstance) {
        try {
          if (typeof pipelineInstance.dispose === "function") {
            await pipelineInstance.dispose();
          }
        } catch {
          // Non-fatal
        }
        pipelineInstance = null;
        pipelineModelId = null;
      }
      postMessage({ type: "DONE", id: req.id });
      break;
    }
  }
}

// ── Worker entry point ────────────────────────────────────────────────────────

// Wire up self.onmessage when running inside a Web Worker.
// We detect the worker context by checking for DedicatedWorkerGlobalScope,
// falling back to checking that `self` is not the same as `window`.
// In Node/vitest, neither condition holds so this block is skipped.
declare const self: any;
if (
  typeof self !== "undefined" &&
  typeof (globalThis as any).DedicatedWorkerGlobalScope !== "undefined" &&
  self instanceof (globalThis as any).DedicatedWorkerGlobalScope
) {
  self.onmessage = (event: MessageEvent<NerWorkerRequest>) => {
    handleWorkerMessage(event.data, (msg: NerWorkerResponse) => self.postMessage(msg));
  };
}
