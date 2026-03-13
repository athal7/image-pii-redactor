import { describe, it, expect } from "vitest";
import { detectPiiCompromise } from "../pii-compromise.js";

describe("detectPiiCompromise", () => {
  // ── Basic detection ─────────────────────────────────────────────────────────

  it("detects a full name in normal sentence context", () => {
    const entities = detectPiiCompromise("Alice Nguyen approved the request.");
    const texts = entities.map((e) => e.text);
    expect(texts).toContain("Alice Nguyen");
  });

  it("detects a lowercase first name in casual chat context", () => {
    // NER and regex both miss this — key reason for adding compromise
    const entities = detectPiiCompromise("thanks alice for the update");
    const texts = entities.map((e) => e.text);
    expect(texts).toContain("alice");
  });

  it("detects a first name in a greeting", () => {
    const entities = detectPiiCompromise("Hi alice, can you review this?");
    expect(entities.map((e) => e.text.replace(/,$/, "").trim())).toContain("alice");
  });

  it("detects an all-caps name (OCR artifact)", () => {
    const entities = detectPiiCompromise("ALICE NGUYEN\n3:15 PM Yesterday");
    const texts = entities.map((e) => e.text);
    expect(texts).toContain("ALICE NGUYEN");
  });

  it("detects a name in a chat sender header", () => {
    const entities = detectPiiCompromise("Alice Nguyen\n6:09 PM Yesterday");
    const texts = entities.map((e) => e.text);
    expect(texts).toContain("Alice Nguyen");
  });

  it("detects a name in a signature block", () => {
    const entities = detectPiiCompromise("Alice Nguyen\nAdvocacy Lead, EU\nMozilla Foundation");
    const texts = entities.map((e) => e.text);
    expect(texts).toContain("Alice Nguyen");
  });

  it("detects a hyphenated name", () => {
    const entities = detectPiiCompromise("al-hassan approved the PR");
    const names = entities.filter((e) => e.label === "PERSON");
    expect(names.length).toBeGreaterThan(0);
  });

  // ── Output shape ────────────────────────────────────────────────────────────

  it("returns entities with correct shape", () => {
    const entities = detectPiiCompromise("John Smith sent a message.");
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(e).toHaveProperty("id");
      expect(e).toHaveProperty("label", "PERSON");
      expect(e).toHaveProperty("text");
      expect(e).toHaveProperty("start");
      expect(e).toHaveProperty("end");
      expect(e).toHaveProperty("score");
      expect(e).toHaveProperty("source", "compromise");
    }
  });

  it("returns correct character offsets", () => {
    const text = "talked to alice yesterday";
    const entities = detectPiiCompromise(text);
    const alice = entities.find((e) => e.text.toLowerCase() === "alice");
    expect(alice).toBeDefined();
    expect(alice!.start).toBe(10);
    expect(alice!.end).toBe(15);
    expect(text.slice(alice!.start, alice!.end)).toBe("alice");
  });

  it("offset slice always matches entity text", () => {
    const text = "bob reviewed it and then alice replied to carol";
    const entities = detectPiiCompromise(text);
    for (const e of entities) {
      expect(text.slice(e.start, e.end)).toBe(e.text);
    }
  });

  // ── False positive suppression ──────────────────────────────────────────────

  it("does not flag org names as people", () => {
    const entities = detectPiiCompromise("Mozilla Foundation issued the request.");
    const texts = entities.map((e) => e.text);
    expect(texts).not.toContain("Mozilla Foundation");
  });

  it("does not flag purely generic text", () => {
    const entities = detectPiiCompromise("the quick brown fox jumps over the lazy dog");
    expect(entities).toHaveLength(0);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it("handles empty string without throwing", () => {
    expect(() => detectPiiCompromise("")).not.toThrow();
    expect(detectPiiCompromise("")).toEqual([]);
  });

  it("handles multiline OCR text", () => {
    const text = "alice said yes\nbob confirmed\nno further action needed";
    const entities = detectPiiCompromise(text);
    const texts = entities.map((e) => e.text);
    expect(texts).toContain("alice");
    expect(texts).toContain("bob");
  });
});
