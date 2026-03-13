/**
 * Pure NER aggregation functions, extracted so they can be:
 *  - imported by the NER Web Worker (ner-worker.ts)
 *  - tested directly in Node without a browser environment
 *
 * No imports from Transformers.js or browser APIs — pure logic only.
 */

import type { PiiEntity } from "../types.js";

export interface RawNerToken {
  entity: string;
  entity_group?: string;
  score: number;
  word: string;
  start: number | null;
  end: number | null;
  index?: number;
}

/**
 * Map pre-aggregated entities (when Transformers.js aggregation works and
 * returns `entity_group` fields rather than raw BIO tokens).
 */
export function mapAggregatedEntities(
  rawEntities: RawNerToken[],
  text: string,
  minConfidence: number,
): PiiEntity[] {
  let idCounter = 0;
  const entities: PiiEntity[] = [];

  for (const entity of rawEntities) {
    if (entity.score < minConfidence) continue;

    const label = entity.entity_group ?? entity.entity ?? "UNKNOWN";
    const word = entity.word ?? "";

    let start = entity.start;
    let end = entity.end;

    if (start == null || end == null) {
      const found = findTextInString(
        text,
        word,
        entities.length > 0 ? (entities[entities.length - 1].end ?? 0) : 0,
      );
      if (found) {
        start = found.start;
        end = found.end;
      } else {
        continue;
      }
    }

    const canonicalText = text.slice(start, end);

    entities.push({
      id: `ner-${idCounter++}`,
      label: cleanLabel(label),
      text: canonicalText || word,
      start,
      end,
      score: entity.score,
      source: "ner",
    });
  }

  return entities;
}

/**
 * Manually aggregate BIO-tagged tokens into entities with character offsets.
 * Used when Transformers.js returns raw token-level results (no entity_group).
 */
export function aggregateAndMapTokens(
  tokens: RawNerToken[],
  text: string,
  minConfidence: number,
): PiiEntity[] {
  const entities: PiiEntity[] = [];
  let idCounter = 0;

  let currentGroup: RawNerToken[] = [];
  let currentType = "";

  for (const token of tokens) {
    const entity = token.entity ?? "";
    if (entity === "O" || entity === "") {
      if (currentGroup.length > 0) {
        const merged = mergeTokenGroup(
          currentGroup,
          currentType,
          text,
          idCounter++,
          minConfidence,
        );
        if (merged) entities.push(merged);
        currentGroup = [];
        currentType = "";
      }
      continue;
    }

    const bioPrefix = entity.substring(0, 2);
    const typeLabel = entity.includes("-") ? entity.substring(2) : entity;

    if (bioPrefix === "B-" || typeLabel !== currentType) {
      if (currentGroup.length > 0) {
        const merged = mergeTokenGroup(
          currentGroup,
          currentType,
          text,
          idCounter++,
          minConfidence,
        );
        if (merged) entities.push(merged);
      }
      currentGroup = [token];
      currentType = typeLabel;
    } else {
      currentGroup.push(token);
    }
  }

  if (currentGroup.length > 0) {
    const merged = mergeTokenGroup(
      currentGroup,
      currentType,
      text,
      idCounter,
      minConfidence,
    );
    if (merged) entities.push(merged);
  }

  return entities;
}

/**
 * Determine whether raw pipeline output is aggregated (has entity_group) or BIO.
 */
export function isAggregatedOutput(tokens: RawNerToken[]): boolean {
  return tokens.length > 0 && tokens[0].entity_group != null;
}

/**
 * Run the appropriate aggregation strategy based on output shape.
 */
export function processRawEntities(
  rawEntities: RawNerToken[],
  text: string,
  minConfidence: number,
): PiiEntity[] {
  if (isAggregatedOutput(rawEntities)) {
    return mapAggregatedEntities(rawEntities, text, minConfidence);
  }
  return aggregateAndMapTokens(rawEntities, text, minConfidence);
}

// ── Private helpers ────────────────────────────────────────────────────────────

function mergeTokenGroup(
  tokens: RawNerToken[],
  typeLabel: string,
  text: string,
  id: number,
  minConfidence: number,
): PiiEntity | null {
  if (tokens.length === 0) return null;

  const avgScore = tokens.reduce((sum, t) => sum + t.score, 0) / tokens.length;
  if (avgScore < minConfidence) return null;

  const firstWithStart = tokens.find((t) => t.start != null);
  const lastWithEnd = [...tokens].reverse().find((t) => t.end != null);

  let start: number;
  let end: number;
  let entityText: string;

  if (firstWithStart?.start != null && lastWithEnd?.end != null) {
    start = firstWithStart.start;
    end = lastWithEnd.end;
    entityText = text.slice(start, end);
  } else {
    const mergedText = tokens
      .map((t) => {
        let word = t.word ?? "";
        if (word.startsWith("##")) word = word.slice(2);
        word = word.replace(/^▁/, "");
        return word;
      })
      .join("");

    const found = findTextInString(text, mergedText, 0);
    if (!found) {
      const firstWord =
        tokens[0].word?.replace(/^▁/, "").replace(/^##/, "") ?? "";
      const found2 = findTextInString(text, firstWord, 0);
      if (!found2) return null;
      start = found2.start;
      end = start + mergedText.length;
    } else {
      start = found.start;
      end = found.end;
    }
    entityText = text.slice(start, end);
  }

  return {
    id: `ner-${id}`,
    label: cleanLabel(typeLabel),
    text: entityText,
    start,
    end,
    score: avgScore,
    source: "ner",
  };
}

function findTextInString(
  text: string,
  needle: string,
  fromIndex: number,
): { start: number; end: number } | null {
  if (!needle || needle.length === 0) return null;

  let idx = text.indexOf(needle, fromIndex);
  if (idx !== -1) return { start: idx, end: idx + needle.length };

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  idx = lowerText.indexOf(lowerNeedle, fromIndex);
  if (idx !== -1) return { start: idx, end: idx + needle.length };

  if (fromIndex > 0) {
    idx = lowerText.indexOf(lowerNeedle, 0);
    if (idx !== -1) return { start: idx, end: idx + needle.length };
  }

  return null;
}

export function cleanLabel(label: string): string {
  if (label.startsWith("B-") || label.startsWith("I-")) {
    return label.substring(2);
  }
  return label;
}
