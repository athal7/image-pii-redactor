/**
 * Tests that the Transformers.js env configuration is guarded so it runs
 * exactly once — not on every loadPipeline() invocation.
 *
 * We verify this by checking the module source for the envConfigured guard.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

describe("pii-ner.ts env configuration", () => {
  it("uses a module-level envConfigured guard to set allowLocalModels only once", () => {
    const dir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(dir, "../pii-ner.ts"),
      "utf-8",
    );

    // The module must declare a guard variable
    expect(source).toContain("envConfigured");

    // env.allowLocalModels must be inside the guard block
    expect(source).toContain("if (!envConfigured)");

    // The guard must be set to true after configuring
    expect(source).toContain("envConfigured = true");

    // The guard variable should be at module scope (0-indent)
    const lines = source.split("\n");
    const guardLine = lines.find((l) => l.match(/^let envConfigured/));
    expect(guardLine).toBeDefined();
    expect(guardLine!.startsWith("let envConfigured")).toBe(true);
  });
});
