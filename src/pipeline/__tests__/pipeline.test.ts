/**
 * Integration tests for the pipeline orchestration layer.
 *
 * OCR and NER are mocked — we test that:
 *  - the pipeline wires the stages correctly
 *  - bridge output (redactions) matches entity + word inputs
 *  - empty / edge-case inputs are handled gracefully
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OcrResult, PiiEntity } from "../../types.js";
import { entitiesToRedactions, mergeEntities } from "../bridge.js";
import { detectPiiRegex } from "../pii-regex.js";
import { findWordsInSpan } from "../ocr.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A realistic OCR result for the string:
 *   "Hello Sarah Johnson, your email is sarah.j@gmail.com today."
 *    0     6     12       21     28    33    41
 */
const FULL_TEXT =
  "Hello Sarah Johnson, your email is sarah.j@gmail.com today.";

const OCR_RESULT: OcrResult = {
  fullText: FULL_TEXT,
  imageWidth: 800,
  imageHeight: 200,
  words: [
    { text: "Hello",               charStart: 0,  charEnd: 5,  bbox: { x0: 10, y0: 10, x1: 60,  y1: 30 }, confidence: 99, lineIndex: 0 },
    { text: "Sarah",               charStart: 6,  charEnd: 11, bbox: { x0: 70, y0: 10, x1: 120, y1: 30 }, confidence: 99, lineIndex: 0 },
    { text: "Johnson,",            charStart: 12, charEnd: 20, bbox: { x0: 130, y0: 10, x1: 210, y1: 30 }, confidence: 99, lineIndex: 0 },
    { text: "your",                charStart: 21, charEnd: 25, bbox: { x0: 220, y0: 10, x1: 260, y1: 30 }, confidence: 99, lineIndex: 0 },
    { text: "email",               charStart: 26, charEnd: 31, bbox: { x0: 270, y0: 10, x1: 320, y1: 30 }, confidence: 99, lineIndex: 0 },
    { text: "is",                  charStart: 32, charEnd: 34, bbox: { x0: 330, y0: 10, x1: 350, y1: 30 }, confidence: 99, lineIndex: 0 },
    { text: "sarah.j@gmail.com",   charStart: 35, charEnd: 52, bbox: { x0: 360, y0: 10, x1: 520, y1: 30 }, confidence: 99, lineIndex: 0 },
    { text: "today.",              charStart: 53, charEnd: 59, bbox: { x0: 530, y0: 10, x1: 600, y1: 30 }, confidence: 99, lineIndex: 0 },
  ],
};

// ── findWordsInSpan ────────────────────────────────────────────────────────────

describe("findWordsInSpan", () => {
  it("finds a single word by exact span", () => {
    const words = findWordsInSpan(OCR_RESULT.words, 6, 11);
    expect(words.map((w) => w.text)).toEqual(["Sarah"]);
  });

  it("finds multiple words spanning a range", () => {
    const words = findWordsInSpan(OCR_RESULT.words, 6, 20);
    expect(words.map((w) => w.text)).toEqual(["Sarah", "Johnson,"]);
  });

  it("finds the email address word", () => {
    // Email spans 35-53
    const words = findWordsInSpan(OCR_RESULT.words, 35, 53);
    expect(words).toHaveLength(1);
    expect(words[0].text).toBe("sarah.j@gmail.com");
  });

  it("returns empty array when span matches no words", () => {
    expect(findWordsInSpan(OCR_RESULT.words, 999, 1010)).toHaveLength(0);
  });

  it("handles span that partially overlaps a word", () => {
    // Span 8-14 overlaps "Sarah" (6-11) and "Johnson," (12-20)
    const words = findWordsInSpan(OCR_RESULT.words, 8, 14);
    const texts = words.map((w) => w.text);
    expect(texts).toContain("Sarah");
    expect(texts).toContain("Johnson,");
  });
});

// ── Full pipeline (mocked OCR + NER) ──────────────────────────────────────────

describe("pipeline integration (mocked OCR + NER)", () => {
  it("produces redactions for NER-detected name entities", () => {
    // Simulate NER finding "Sarah Johnson" as a SURNAME entity
    const nerEntities: PiiEntity[] = [
      { id: "n1", label: "SURNAME", text: "Sarah Johnson", start: 6, end: 19, score: 0.95, source: "ner" },
    ];
    const merged = mergeEntities(nerEntities, []);
    const redactions = entitiesToRedactions(merged, OCR_RESULT.words);

    expect(redactions).toHaveLength(1);
    // Should cover both "Sarah" and "Johnson,"
    expect(redactions[0].bbox.x0).toBeLessThanOrEqual(70);
    expect(redactions[0].bbox.x1).toBeGreaterThanOrEqual(210);
  });

  it("produces redactions for regex-detected email", () => {
    const regexEntities = detectPiiRegex(FULL_TEXT);
    const redactions = entitiesToRedactions(regexEntities, OCR_RESULT.words);

    const emailRedactions = redactions.filter(
      (r) => r.label === "EMAIL" || r.label === "URL"
    );
    expect(emailRedactions.length).toBeGreaterThan(0);
    // The email word bbox should be covered
    const r = emailRedactions[0];
    expect(r.bbox.x0).toBeLessThanOrEqual(360 + 2); // email word x0 + padding
  });

  it("merges overlapping NER + regex detections of the same email", () => {
    const nerEntities: PiiEntity[] = [
      { id: "n1", label: "EMAIL", text: "sarah.j@gmail.com", start: 35, end: 53, score: 0.92, source: "ner" },
    ];
    const regexEntities: PiiEntity[] = [
      { id: "r1", label: "EMAIL", text: "sarah.j@gmail.com", start: 35, end: 53, score: 1.0, source: "regex" },
    ];
    const merged = mergeEntities(nerEntities, regexEntities);
    // Should deduplicate to 1
    expect(merged).toHaveLength(1);
    const redactions = entitiesToRedactions(merged, OCR_RESULT.words);
    expect(redactions).toHaveLength(1);
  });

  it("returns no redactions when OCR finds no text", () => {
    const emptyOcr: OcrResult = { fullText: "", imageWidth: 100, imageHeight: 100, words: [] };
    const entities = detectPiiRegex(emptyOcr.fullText);
    const redactions = entitiesToRedactions(entities, emptyOcr.words);
    expect(redactions).toHaveLength(0);
  });

  it("all redaction bboxes are within image bounds", () => {
    const nerEntities: PiiEntity[] = [
      { id: "n1", label: "SURNAME", text: "Sarah", start: 6, end: 11, score: 0.95, source: "ner" },
    ];
    const redactions = entitiesToRedactions(nerEntities, OCR_RESULT.words);
    for (const r of redactions) {
      expect(r.bbox.x0).toBeGreaterThanOrEqual(0);
      expect(r.bbox.y0).toBeGreaterThanOrEqual(0);
      expect(r.bbox.x1).toBeLessThanOrEqual(OCR_RESULT.imageWidth + 10); // allow padding
      expect(r.bbox.y1).toBeLessThanOrEqual(OCR_RESULT.imageHeight + 10);
    }
  });
});

// ── OCR text reconstruction ───────────────────────────────────────────────────

describe("OCR word index (charStart / charEnd)", () => {
  it("consecutive words have contiguous char offsets", () => {
    const words = OCR_RESULT.words;
    for (let i = 0; i < words.length - 1; i++) {
      // charEnd of word i should be <= charStart of word i+1
      // (there may be whitespace between them)
      expect(words[i].charEnd).toBeLessThanOrEqual(words[i + 1].charStart);
    }
  });

  it("charEnd - charStart equals word text length", () => {
    for (const w of OCR_RESULT.words) {
      expect(w.charEnd - w.charStart).toBe(w.text.length);
    }
  });

  it("fullText slice at charStart:charEnd matches word text", () => {
    for (const w of OCR_RESULT.words) {
      expect(FULL_TEXT.slice(w.charStart, w.charEnd)).toBe(w.text);
    }
  });
});
