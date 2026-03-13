// @vitest-environment jsdom

/**
 * Tests for PiiRedactor component property declarations.
 *
 * Verifies that public configurable properties have @property() decorators
 * so they can be set via HTML attributes.
 */

import { describe, it, expect } from "vitest";

// We import the class definition only — no DOM rendering needed.
// The Lit @property() decorator registers metadata on the class so we can
// inspect it without mounting the element.
import { PiiRedactor } from "../component/pii-redactor.js";

describe("PiiRedactor property declarations", () => {
  it("useRegex is declared as a Lit property (has @property decorator)", () => {
    // Lit stores observed attributes on the static observedAttributes getter,
    // which is derived from @property() decorators.
    const observed = PiiRedactor.observedAttributes;
    expect(observed).toContain("use-regex");
  });

  it("other expected attributes are also observed", () => {
    const observed = PiiRedactor.observedAttributes;
    expect(observed).toContain("lang");
    expect(observed).toContain("ner-model");
    expect(observed).toContain("max-file-size");
    expect(observed).toContain("min-confidence");
  });

  it("useRegex defaults to true", () => {
    // Default value from the class definition
    const element = new PiiRedactor();
    expect((element as any).useRegex).toBe(true);
  });

  it("useCompromise is declared as a Lit property (has @property decorator)", () => {
    const observed = PiiRedactor.observedAttributes;
    expect(observed).toContain("use-compromise");
  });

  it("useCompromise defaults to true", () => {
    const element = new PiiRedactor();
    expect((element as any).useCompromise).toBe(true);
  });
});
