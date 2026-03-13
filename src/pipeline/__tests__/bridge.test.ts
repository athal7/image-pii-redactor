import { describe, it, expect } from "vitest";
import { entitiesToRedactions, mergeEntities } from "../bridge.js";
import type { OcrWord, PiiEntity } from "../../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWord(
  text: string,
  charStart: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  lineIndex = 0,
): OcrWord {
  return { text, charStart, charEnd: charStart + text.length, bbox, confidence: 99, lineIndex };
}

function makeEntity(
  id: string,
  label: string,
  text: string,
  start: number,
  end: number,
  source: "ner" | "regex" | "compromise" = "ner",
  score = 0.95,
): PiiEntity {
  return { id, label, text, start, end, score, source };
}

// Reconstruct the OCR word list for a simple sentence
// "Hello Sarah Johnson today"
//  0     6     12    20
const WORDS: OcrWord[] = [
  makeWord("Hello",   0,  { x0: 10, y0: 10, x1: 60,  y1: 30 }),
  makeWord("Sarah",   6,  { x0: 70, y0: 10, x1: 120, y1: 30 }),
  makeWord("Johnson", 12, { x0: 130, y0: 10, x1: 210, y1: 30 }),
  makeWord("today",   20, { x0: 220, y0: 10, x1: 270, y1: 30 }),
];

// ── entitiesToRedactions ─────────────────────────────────────────────────────

describe("entitiesToRedactions", () => {
  it("maps a single-word entity to its word bbox", () => {
    const entities = [makeEntity("e1", "GIVENNAME", "Sarah", 6, 11)];
    const redactions = entitiesToRedactions(entities, WORDS);

    expect(redactions).toHaveLength(1);
    // Sarah's bbox x0 is 70, minus 2px padding = 68
    expect(redactions[0].bbox.x0).toBe(68);
    expect(redactions[0].label).toBe("GIVENNAME");
    expect(redactions[0].source).toBe("auto");
    expect(redactions[0].enabled).toBe(true);
  });

  it("maps a multi-word entity to the union bbox of all covered words", () => {
    const entities = [makeEntity("e1", "SURNAME", "Sarah Johnson", 6, 19)];
    const redactions = entitiesToRedactions(entities, WORDS);

    expect(redactions).toHaveLength(1);
    // x0 should be Sarah's x0, x1 should be Johnson's x1 (plus padding)
    expect(redactions[0].bbox.x0).toBeLessThanOrEqual(70);
    expect(redactions[0].bbox.x1).toBeGreaterThanOrEqual(210);
  });

  it("splits multi-line entities into one redaction per line", () => {
    const multiLineWords: OcrWord[] = [
      makeWord("Sarah",   0,  { x0: 10, y0: 10, x1: 60,  y1: 30 }, 0),
      makeWord("Johnson", 6,  { x0: 10, y0: 50, x1: 80,  y1: 70 }, 1),
    ];
    const entities = [makeEntity("e1", "SURNAME", "Sarah Johnson", 0, 13)];
    const redactions = entitiesToRedactions(entities, multiLineWords);

    // One redaction per line
    expect(redactions).toHaveLength(2);
    const lines = new Set(redactions.map((r) => r.bbox.y0));
    expect(lines.size).toBe(2);
  });

  it("skips entities that don't overlap any words", () => {
    // Entity at offset 999 — well beyond any word
    const entities = [makeEntity("e1", "EMAIL", "ghost@example.com", 999, 1016)];
    const redactions = entitiesToRedactions(entities, WORDS);
    expect(redactions).toHaveLength(0);
  });

  it("applies padding to bboxes", () => {
    const entities = [makeEntity("e1", "GIVENNAME", "Sarah", 6, 11)];
    const redactions = entitiesToRedactions(entities, WORDS);
    // x0 should be Sarah's x0 (70) minus the 2px padding
    expect(redactions[0].bbox.x0).toBe(68);
    expect(redactions[0].bbox.x1).toBe(122);
  });

  it("links redaction back to its entity via entityId", () => {
    const entities = [makeEntity("e1", "GIVENNAME", "Sarah", 6, 11)];
    const redactions = entitiesToRedactions(entities, WORDS);
    expect(redactions[0].entityId).toBe("e1");
  });

  it("handles empty entity list gracefully", () => {
    expect(entitiesToRedactions([], WORDS)).toEqual([]);
  });

  it("handles empty word list gracefully", () => {
    const entities = [makeEntity("e1", "EMAIL", "sarah@x.com", 0, 11)];
    expect(entitiesToRedactions(entities, [])).toHaveLength(0);
  });

  it("splits words on the same Tesseract line that have a large horizontal gap (cross-column layout)", () => {
    // Scenario: two-column chat UI where OCR groups the entire row as one line.
    // "Alice Nguyen ee" — "Alice Nguyen" is at x≈60 (left column),
    // "ee" is at x≈828 (right column, OCR artifact from the other column).
    // "Alice Nguyen ee" would produce a single bbox spanning x=60 to x=860
    // which is wrong — only "Alice Nguyen" should be redacted.
    const crossColumnWords: OcrWord[] = [
      makeWord("Alice",  0, { x0: 60,  y0: 41, x1: 105, y1: 60 }, 1),
      makeWord("Nguyen", 6, { x0: 105, y0: 41, x1: 161, y1: 60 }, 1),
      makeWord("ee",     13, { x0: 828, y0: 33, x1: 858, y1: 55 }, 1), // far-right OCR artifact
    ];
    // Entity spans "Alice Nguyen ee" (start=0, end=15)
    const entities = [makeEntity("e1", "PERSON", "Alice Nguyen ee", 0, 15, "compromise", 0.75)];
    const redactions = entitiesToRedactions(entities, crossColumnWords);

    // Should produce 2 separate redactions (not one giant bbox):
    // one for "Alice Nguyen" (left column), one for "ee" (right column artifact)
    expect(redactions).toHaveLength(2);

    // The first redaction should cover only the left-column words
    const leftRedaction = redactions.find(r => r.bbox.x0 < 200);
    expect(leftRedaction).toBeDefined();
    expect(leftRedaction!.bbox.x1).toBeLessThan(200); // should NOT extend to x=828

    // The right-column redaction should be separate
    const rightRedaction = redactions.find(r => r.bbox.x0 > 700);
    expect(rightRedaction).toBeDefined();
  });
});

// ── mergeEntities ─────────────────────────────────────────────────────────────

describe("mergeEntities", () => {
  it("returns NER entities when there are no regex entities", () => {
    const ner = [makeEntity("n1", "GIVENNAME", "Sarah", 0, 5)];
    expect(mergeEntities(ner, [])).toEqual(ner);
  });

  it("returns regex entities when there are no NER entities", () => {
    const regex = [makeEntity("r1", "EMAIL", "x@y.com", 10, 17, "regex")];
    expect(mergeEntities([], regex)).toEqual(regex);
  });

  it("keeps non-overlapping entities from both sources", () => {
    const ner = [makeEntity("n1", "GIVENNAME", "Sarah", 0, 5)];
    const regex = [makeEntity("r1", "EMAIL", "x@y.com", 10, 17, "regex")];
    const merged = mergeEntities(ner, regex);
    expect(merged).toHaveLength(2);
  });

  it("deduplicates exact overlaps, preferring NER over regex", () => {
    const ner   = [makeEntity("n1", "EMAIL", "x@y.com", 10, 17, "ner",   0.92)];
    const regex = [makeEntity("r1", "EMAIL", "x@y.com", 10, 17, "regex", 1.00)];
    const merged = mergeEntities(ner, regex);
    expect(merged).toHaveLength(1);
    // NER gets +0.1 boost so should win even though regex score is higher
    expect(merged[0].source).toBe("ner");
  });

  it("keeps the longer span when entities partially overlap", () => {
    // NER finds "Sarah Johnson" (wider), regex finds "Sarah" (narrower)
    const ner   = [makeEntity("n1", "SURNAME",  "Sarah Johnson", 0, 13, "ner")];
    const regex = [makeEntity("r1", "GIVENNAME","Sarah",          0,  5, "regex")];
    const merged = mergeEntities(ner, regex);
    expect(merged).toHaveLength(1);
    expect(merged[0].end).toBe(13); // wider span wins
  });

  it("sorts merged output by start offset", () => {
    const ner   = [makeEntity("n1", "GIVENNAME", "Sarah", 20, 25)];
    const regex = [makeEntity("r1", "EMAIL", "a@b.com", 0, 7, "regex")];
    const merged = mergeEntities(ner, regex);
    expect(merged[0].start).toBeLessThan(merged[1].start);
  });
});
