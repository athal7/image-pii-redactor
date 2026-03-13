/**
 * Tests for the LABEL_DISPLAY_NAMES map in src/types.ts.
 */

import { describe, it, expect } from "vitest";
import { LABEL_DISPLAY_NAMES } from "../types.js";

describe("LABEL_DISPLAY_NAMES", () => {
  it("is exported from types.ts", () => {
    expect(LABEL_DISPLAY_NAMES).toBeDefined();
    expect(typeof LABEL_DISPLAY_NAMES).toBe("object");
  });

  it("maps GIVENNAME to a human-readable label", () => {
    expect(LABEL_DISPLAY_NAMES["GIVENNAME"]).toBeDefined();
    expect(LABEL_DISPLAY_NAMES["GIVENNAME"]).not.toBe("GIVENNAME");
  });

  it("maps TELEPHONENUM to a human-readable label", () => {
    expect(LABEL_DISPLAY_NAMES["TELEPHONENUM"]).toBeDefined();
    expect(LABEL_DISPLAY_NAMES["TELEPHONENUM"]).not.toBe("TELEPHONENUM");
  });

  it("maps STREET to a human-readable label", () => {
    expect(LABEL_DISPLAY_NAMES["STREET"]).toBeDefined();
    expect(LABEL_DISPLAY_NAMES["STREET"]).not.toBe("STREET");
  });

  it("maps common NER labels", () => {
    const expectedLabels = [
      "GIVENNAME", "SURNAME", "EMAIL", "TELEPHONENUM",
      "STREET", "CITY", "ZIPCODE", "SSN", "CREDITCARD",
      "DATE", "URL", "USERNAME", "IP_ADDRESS",
    ];
    for (const label of expectedLabels) {
      expect(LABEL_DISPLAY_NAMES[label], `Missing display name for ${label}`).toBeDefined();
    }
  });

  it("all values are non-empty strings", () => {
    for (const [key, value] of Object.entries(LABEL_DISPLAY_NAMES)) {
      expect(typeof value, `${key} value should be a string`).toBe("string");
      expect(value.length, `${key} display name should not be empty`).toBeGreaterThan(0);
    }
  });
});
