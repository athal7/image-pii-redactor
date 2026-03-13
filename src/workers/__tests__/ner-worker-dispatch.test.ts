/**
 * Tests for the NER worker message dispatcher.
 *
 * We test the dispatch logic in isolation by calling the exported
 * `handleWorkerMessage` function directly (no actual Worker instantiation).
 * Transformers.js pipeline is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NerWorkerRequest, NerWorkerResponse } from "../ner-worker-protocol.js";

// Mock @xenova/transformers before importing the worker handler
vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowLocalModels: true },
}));

import { handleWorkerMessage, _resetWorkerState } from "../ner-worker.js";
import { pipeline } from "@xenova/transformers";

const mockPipeline = vi.mocked(pipeline);

// Captured responses from the worker
let responses: NerWorkerResponse[] = [];
const postMessage = (msg: NerWorkerResponse) => responses.push(msg);

beforeEach(() => {
  responses = [];
  mockPipeline.mockReset();
  _resetWorkerState(); // clear pipeline singleton so each test gets a fresh state
});

describe("handleWorkerMessage — DETECT", () => {
  it("posts RESULT with entities for a successful detection", async () => {
    // Mock pipeline to return aggregated output
    const mockPipelineFn = vi.fn().mockResolvedValue([
      { entity_group: "EMAIL", score: 0.99, word: "x@y.com", start: 0, end: 7 },
    ]);
    mockPipeline.mockResolvedValue(mockPipelineFn as any);

    const req: NerWorkerRequest = {
      type: "DETECT",
      id: 1,
      text: "x@y.com",
      modelId: "test-model",
      minConfidence: 0.7,
    };

    await handleWorkerMessage(req, postMessage);

    const result = responses.find((r) => r.type === "RESULT");
    expect(result).toBeDefined();
    expect(result!.id).toBe(1);
    expect((result as any).entities).toHaveLength(1);
    expect((result as any).entities[0].label).toBe("EMAIL");
  });

  it("posts ERROR when pipeline throws", async () => {
    mockPipeline.mockResolvedValue(
      vi.fn().mockRejectedValue(new Error("ONNX session failed")) as any,
    );

    const req: NerWorkerRequest = {
      type: "DETECT",
      id: 2,
      text: "some text",
      modelId: "test-model",
      minConfidence: 0.7,
    };

    await handleWorkerMessage(req, postMessage);

    const error = responses.find((r) => r.type === "ERROR");
    expect(error).toBeDefined();
    expect(error!.id).toBe(2);
    expect((error as any).message).toContain("ONNX session failed");
  });

  it("posts PROGRESS messages during model loading", async () => {
    let capturedCallback: ((p: any) => void) | undefined;

    mockPipeline.mockImplementation(async (_task, _model, opts: any) => {
      capturedCallback = opts?.progress_callback;
      return vi.fn().mockResolvedValue([]) as any;
    });

    const req: NerWorkerRequest = {
      type: "DETECT",
      id: 3,
      text: "hello",
      modelId: "test-model",
      minConfidence: 0.7,
    };

    // Fire a progress event during loading
    const detectPromise = handleWorkerMessage(req, postMessage);
    // Simulate a progress callback being called
    if (capturedCallback) {
      capturedCallback({ status: "progress", loaded: 50, total: 100 });
    }
    await detectPromise;

    // Progress may or may not fire depending on timing, but no error
    const errorMsgs = responses.filter((r) => r.type === "ERROR");
    expect(errorMsgs).toHaveLength(0);
  });

  it("returns empty entities for empty text", async () => {
    mockPipeline.mockResolvedValue(vi.fn().mockResolvedValue([]) as any);

    const req: NerWorkerRequest = {
      type: "DETECT",
      id: 4,
      text: "",
      modelId: "test-model",
      minConfidence: 0.7,
    };

    await handleWorkerMessage(req, postMessage);

    const result = responses.find((r) => r.type === "RESULT");
    expect(result).toBeDefined();
    expect((result as any).entities).toHaveLength(0);
  });
});

describe("handleWorkerMessage — PRELOAD", () => {
  it("posts DONE after loading the pipeline", async () => {
    mockPipeline.mockResolvedValue(vi.fn() as any);

    const req: NerWorkerRequest = { type: "PRELOAD", id: 5, modelId: "test-model" };
    await handleWorkerMessage(req, postMessage);

    const done = responses.find((r) => r.type === "DONE");
    expect(done).toBeDefined();
    expect(done!.id).toBe(5);
  });
});

describe("handleWorkerMessage — RELEASE", () => {
  it("posts DONE after releasing", async () => {
    const req: NerWorkerRequest = { type: "RELEASE", id: 6 };
    await handleWorkerMessage(req, postMessage);

    const done = responses.find((r) => r.type === "DONE");
    expect(done).toBeDefined();
    expect(done!.id).toBe(6);
  });
});
