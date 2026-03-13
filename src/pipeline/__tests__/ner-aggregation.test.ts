/**
 * Direct unit tests for the extracted NER aggregation pure functions.
 *
 * These tests replace the indirect shape-testing in pii-ner.test.ts with
 * direct calls to the aggregation functions. Tests run in Node (no browser).
 */

import { describe, it, expect } from "vitest";
import {
  mapAggregatedEntities,
  aggregateAndMapTokens,
  processRawEntities,
  isAggregatedOutput,
  cleanLabel,
  type RawNerToken,
} from "../ner-aggregation.js";

const TEXT = "Hello Sarah Johnson, email: sarah.j@gmail.com";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AGGREGATED: RawNerToken[] = [
  { entity: "", entity_group: "GIVENNAME", score: 0.98, word: "Sarah", start: 6, end: 11 },
  { entity: "", entity_group: "SURNAME",   score: 0.95, word: "Johnson", start: 12, end: 19 },
  { entity: "", entity_group: "EMAIL",     score: 0.99, word: "sarah.j@gmail.com", start: 28, end: 45 },
];

const BIO_NAME: RawNerToken[] = [
  { entity: "B-GIVENNAME", score: 0.98, word: "▁Sarah",   start: 6,  end: 11, index: 1 },
  { entity: "B-SURNAME",   score: 0.95, word: "▁Johnson", start: 12, end: 19, index: 2 },
  { entity: "O",           score: 0.99, word: ",",        start: 19, end: 20, index: 3 },
];

// ── cleanLabel ────────────────────────────────────────────────────────────────

describe("cleanLabel", () => {
  it("strips B- prefix", () => expect(cleanLabel("B-EMAIL")).toBe("EMAIL"));
  it("strips I- prefix", () => expect(cleanLabel("I-GIVENNAME")).toBe("GIVENNAME"));
  it("leaves bare labels unchanged", () => expect(cleanLabel("SSN")).toBe("SSN"));
});

// ── isAggregatedOutput ────────────────────────────────────────────────────────

describe("isAggregatedOutput", () => {
  it("returns true when first token has entity_group", () => {
    expect(isAggregatedOutput(AGGREGATED)).toBe(true);
  });

  it("returns false for BIO tokens (no entity_group)", () => {
    expect(isAggregatedOutput(BIO_NAME)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(isAggregatedOutput([])).toBe(false);
  });
});

// ── mapAggregatedEntities ─────────────────────────────────────────────────────

describe("mapAggregatedEntities", () => {
  it("maps all entities above minConfidence", () => {
    const entities = mapAggregatedEntities(AGGREGATED, TEXT, 0.7);
    expect(entities).toHaveLength(3);
  });

  it("filters entities below minConfidence", () => {
    const entities = mapAggregatedEntities(AGGREGATED, TEXT, 0.97);
    // Only score 0.98 and 0.99 pass
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.label)).toContain("GIVENNAME");
    expect(entities.map((e) => e.label)).toContain("EMAIL");
  });

  it("uses canonical text from source string (not word field)", () => {
    const entities = mapAggregatedEntities(AGGREGATED, TEXT, 0.7);
    const email = entities.find((e) => e.label === "EMAIL")!;
    expect(email.text).toBe(TEXT.slice(email.start, email.end));
  });

  it("sets source to 'ner'", () => {
    const entities = mapAggregatedEntities(AGGREGATED, TEXT, 0.7);
    expect(entities.every((e) => e.source === "ner")).toBe(true);
  });

  it("assigns unique ids", () => {
    const entities = mapAggregatedEntities(AGGREGATED, TEXT, 0.7);
    const ids = entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to text search when start/end are null", () => {
    const noOffsets: RawNerToken[] = [
      { entity: "", entity_group: "EMAIL", score: 0.99, word: "sarah.j@gmail.com", start: null, end: null },
    ];
    const entities = mapAggregatedEntities(noOffsets, TEXT, 0.7);
    expect(entities).toHaveLength(1);
    expect(entities[0].text).toBe("sarah.j@gmail.com");
  });
});

// ── aggregateAndMapTokens ─────────────────────────────────────────────────────

describe("aggregateAndMapTokens", () => {
  it("groups B/I tokens into one entity", () => {
    const tokens: RawNerToken[] = [
      { entity: "B-TELEPHONENUM", score: 0.98, word: "▁555", start: 0, end: 3, index: 1 },
      { entity: "I-TELEPHONENUM", score: 0.97, word: "-867", start: 3, end: 7, index: 2 },
      { entity: "I-TELEPHONENUM", score: 0.97, word: "-5309", start: 7, end: 12, index: 3 },
      { entity: "O", score: 0.99, word: ".", start: 12, end: 13, index: 4 },
    ];
    const text = "555-867-5309.";
    const entities = aggregateAndMapTokens(tokens, text, 0.7);
    expect(entities).toHaveLength(1);
    expect(entities[0].label).toBe("TELEPHONENUM");
    expect(entities[0].start).toBe(0);
    expect(entities[0].end).toBe(12);
  });

  it("splits B- tokens of different types into separate entities", () => {
    const entities = aggregateAndMapTokens(BIO_NAME, TEXT, 0.7);
    expect(entities).toHaveLength(2);
    expect(entities[0].label).toBe("GIVENNAME");
    expect(entities[1].label).toBe("SURNAME");
  });

  it("skips O tokens", () => {
    const entities = aggregateAndMapTokens(BIO_NAME, TEXT, 0.7);
    expect(entities.every((e) => e.label !== "O")).toBe(true);
  });

  it("filters groups below minConfidence", () => {
    const lowConf: RawNerToken[] = [
      { entity: "B-EMAIL", score: 0.50, word: "▁x@y.com", start: 0, end: 8, index: 1 },
    ];
    const entities = aggregateAndMapTokens(lowConf, "x@y.com", 0.7);
    expect(entities).toHaveLength(0);
  });
});

// ── processRawEntities ────────────────────────────────────────────────────────

describe("processRawEntities", () => {
  it("routes aggregated output through mapAggregatedEntities", () => {
    const entities = processRawEntities(AGGREGATED, TEXT, 0.7);
    expect(entities).toHaveLength(3);
  });

  it("routes BIO output through aggregateAndMapTokens", () => {
    const entities = processRawEntities(BIO_NAME, TEXT, 0.7);
    expect(entities).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(processRawEntities([], TEXT, 0.7)).toHaveLength(0);
  });
});
