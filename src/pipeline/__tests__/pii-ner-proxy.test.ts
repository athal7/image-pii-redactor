/**
 * Tests for the main-thread NER proxy (pii-ner.ts).
 *
 * The Worker is mocked — we verify that:
 *  - detectPiiNer sends the correct DETECT message and resolves with entities
 *  - preloadNerModel sends PRELOAD and resolves when DONE
 *  - releaseNerModel sends RELEASE, resolves when DONE, and terminates the worker
 *  - progress callbacks fire for PROGRESS messages
 *  - errors from the worker reject the promise
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NerWorkerRequest, NerWorkerResponse } from "../../workers/ner-worker-protocol.js";

// ── Mock Worker ───────────────────────────────────────────────────────────────

type WorkerListener = (event: { data: NerWorkerResponse }) => void;

class MockWorker {
  onmessage: WorkerListener | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  /** Simulate the worker posting a message back to the main thread. */
  simulateResponse(msg: NerWorkerResponse) {
    this.onmessage?.({ data: msg });
  }
}

let mockWorkerInstance: MockWorker;
vi.mock("../../workers/ner-worker.js?worker&inline", () => ({}));

// We'll inject the mock Worker factory via the module's exported setter.
// The proxy module must export a `_setWorkerFactory` for testing.

import {
  detectPiiNer,
  preloadNerModel,
  releaseNerModel,
  _setWorkerFactory,
} from "../pii-ner.js";

beforeEach(() => {
  mockWorkerInstance = new MockWorker();
  _setWorkerFactory(() => mockWorkerInstance as unknown as Worker);
});

// ── detectPiiNer ──────────────────────────────────────────────────────────────

describe("detectPiiNer (proxy)", () => {
  it("sends DETECT message with correct fields", async () => {
    const detectPromise = detectPiiNer("hello world", "test-model", 0.8);

    // Grab the sent message
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledOnce();
    const sent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;
    expect(sent.type).toBe("DETECT");
    expect((sent as any).text).toBe("hello world");
    expect((sent as any).modelId).toBe("test-model");
    expect((sent as any).minConfidence).toBe(0.8);

    // Simulate RESULT response
    const id = sent.id;
    mockWorkerInstance.simulateResponse({
      type: "RESULT",
      id,
      entities: [
        { id: "ner-0", label: "EMAIL", text: "x@y.com", start: 0, end: 7, score: 0.99, source: "ner" },
      ],
    });

    const entities = await detectPromise;
    expect(entities).toHaveLength(1);
    expect(entities[0].label).toBe("EMAIL");
  });

  it("rejects when worker posts ERROR", async () => {
    const detectPromise = detectPiiNer("text", "test-model", 0.7);
    const sent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;

    mockWorkerInstance.simulateResponse({
      type: "ERROR",
      id: sent.id,
      message: "pipeline crashed",
    });

    await expect(detectPromise).rejects.toThrow("pipeline crashed");
  });

  it("fires onProgress for PROGRESS messages", async () => {
    const progressEvents: any[] = [];
    const detectPromise = detectPiiNer("text", "test-model", 0.7, (e) =>
      progressEvents.push(e),
    );

    const sent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;

    // Send a progress event then the result
    mockWorkerInstance.simulateResponse({
      type: "PROGRESS",
      id: sent.id,
      event: { phase: "loading", progress: 0.5, message: "50%" },
    });
    mockWorkerInstance.simulateResponse({ type: "RESULT", id: sent.id, entities: [] });

    await detectPromise;
    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0].phase).toBe("loading");
    expect(progressEvents[0].progress).toBe(0.5);
  });

  it("ignores responses with mismatched id", async () => {
    const detectPromise = detectPiiNer("text", "test-model", 0.7);
    const sent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;

    // Wrong id — should be ignored
    mockWorkerInstance.simulateResponse({ type: "RESULT", id: sent.id + 999, entities: [] });
    // Correct id — resolves
    mockWorkerInstance.simulateResponse({ type: "RESULT", id: sent.id, entities: [] });

    const entities = await detectPromise;
    expect(entities).toHaveLength(0);
  });
});

// ── preloadNerModel ───────────────────────────────────────────────────────────

describe("preloadNerModel (proxy)", () => {
  it("sends PRELOAD and resolves on DONE", async () => {
    const preloadPromise = preloadNerModel("test-model");

    const sent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;
    expect(sent.type).toBe("PRELOAD");
    expect((sent as any).modelId).toBe("test-model");

    mockWorkerInstance.simulateResponse({ type: "DONE", id: sent.id });
    await expect(preloadPromise).resolves.toBeUndefined();
  });

  it("rejects on worker ERROR", async () => {
    const preloadPromise = preloadNerModel("bad-model");
    const sent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;
    mockWorkerInstance.simulateResponse({ type: "ERROR", id: sent.id, message: "load failed" });
    await expect(preloadPromise).rejects.toThrow("load failed");
  });
});

// ── releaseNerModel ───────────────────────────────────────────────────────────

describe("releaseNerModel (proxy)", () => {
  it("sends RELEASE, resolves on DONE, and terminates the worker", async () => {
    // First establish a worker by starting (and immediately resolving) a preload
    const preloadPromise = preloadNerModel("test-model");
    const preloadSent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;
    mockWorkerInstance.simulateResponse({ type: "DONE", id: preloadSent.id });
    await preloadPromise;

    mockWorkerInstance.postMessage.mockClear();

    const releasePromise = releaseNerModel();
    const sent = mockWorkerInstance.postMessage.mock.calls[0][0] as NerWorkerRequest;
    expect(sent.type).toBe("RELEASE");

    mockWorkerInstance.simulateResponse({ type: "DONE", id: sent.id });
    await releasePromise;

    expect(mockWorkerInstance.terminate).toHaveBeenCalledOnce();
  });
});
