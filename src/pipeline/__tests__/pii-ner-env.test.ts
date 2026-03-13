/**
 * Tests that the Transformers.js env configuration guard lives in the worker,
 * not on the main thread. After the Web Worker refactor, pii-ner.ts is a thin
 * proxy — env configuration happens inside ner-worker.ts where the pipeline runs.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

describe("ner-worker.ts env configuration", () => {
  it("uses a module-level envConfigured guard to set allowLocalModels only once", () => {
    const dir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
    // Guard now lives in the worker, not the main-thread proxy
    const source = readFileSync(
      resolve(dir, "../../workers/ner-worker.ts"),
      "utf-8",
    );

    expect(source).toContain("envConfigured");
    expect(source).toContain("if (!envConfigured)");
    expect(source).toContain("envConfigured = true");

    const lines = source.split("\n");
    const guardLine = lines.find((l) => l.match(/^let envConfigured/));
    expect(guardLine).toBeDefined();
    expect(guardLine!.startsWith("let envConfigured")).toBe(true);
  });

  it("pii-ner.ts (main-thread proxy) does not set allowLocalModels directly", () => {
    const dir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
    const proxySource = readFileSync(resolve(dir, "../pii-ner.ts"), "utf-8");
    // The main thread proxy delegates all inference to the worker and must
    // not mutate global env state itself
    expect(proxySource).not.toContain("allowLocalModels");
    expect(proxySource).not.toContain("env.allow");
  });
});
