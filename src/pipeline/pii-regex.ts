import type { PiiEntity } from "../types.js";

/**
 * Regex-based PII detection for structured patterns that NER models
 * typically miss. These complement the NER model, not replace it.
 *
 * Each pattern has a label matching the NER entity taxonomy where possible.
 */
interface PiiPattern {
  label: string;
  pattern: RegExp;
}

const PII_PATTERNS: PiiPattern[] = [
  // Email addresses
  {
    label: "EMAIL",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  // Phone numbers (various formats)
  {
    label: "TELEPHONENUM",
    pattern:
      /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x)\.?\s*\d{1,5})?/g,
  },
  // International phone numbers
  {
    label: "TELEPHONENUM",
    pattern: /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
  },
  // Social Security Numbers (US) — require consistent separators between all
  // groups (backreference) to avoid matching zip+4 codes like 94102-1234
  // (which would parse as 941-02-1234 with mixed separators).
  {
    label: "SSN",
    pattern: /\b\d{3}([-.\s])\d{2}\1\d{4}\b/g,
  },
  // Credit card numbers — require exactly 4 groups of 4 digits with a
  // consistent separator char (space, hyphen, or dot) OR 16 consecutive
  // digits (OCR may strip spaces). This avoids matching SSNs (9 digits)
  // and phone numbers (10 digits with different groupings).
  {
    label: "CREDITCARD",
    pattern: /\b\d{4}([ .-])\d{4}\1\d{4}\1\d{4}\b|\b\d{16}\b/g,
  },
  // IP addresses (v4)
  {
    label: "IP_ADDRESS",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },
  // Dates (various formats — these often contain birth dates)
  {
    label: "DATE",
    pattern:
      /\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})\b/g,
  },
  // URLs with paths (may contain identifying query params)
  {
    label: "URL",
    pattern: /https?:\/\/[^\s<>"{}|\\^`[\]]+/g,
  },
  // Street addresses (basic US pattern)
  {
    label: "STREET",
    pattern: /\b\d{1,5}\s+[\w\s]{1,30}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl)\.?\b/gi,
  },
  // Zip codes (US)
  {
    label: "ZIPCODE",
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
  },
  // Usernames / handles (@mentions)
  {
    label: "USERNAME",
    pattern: /@[a-zA-Z0-9_]{2,30}\b/g,
  },
];

let idCounter = 0;

/**
 * Run regex-based PII detection on the OCR text.
 * Returns deduplicated entities sorted by position.
 */
export function detectPiiRegex(text: string): PiiEntity[] {
  const entities: PiiEntity[] = [];

  for (const { label, pattern } of PII_PATTERNS) {
    // Reset regex state (global flag)
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      entities.push({
        id: `regex-${idCounter++}`,
        label,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        score: 1.0,
        source: "regex",
      });
    }
  }

  // Sort by start position, then deduplicate overlapping spans
  entities.sort((a, b) => a.start - b.start || b.end - a.end);
  return deduplicateEntities(entities);
}

/**
 * Remove entities that are fully contained within another entity.
 * When two overlap, keep the longer one.
 */
function deduplicateEntities(sorted: PiiEntity[]): PiiEntity[] {
  const result: PiiEntity[] = [];

  for (const entity of sorted) {
    const prev = result[result.length - 1];
    if (prev && entity.start >= prev.start && entity.end <= prev.end) {
      // Current is fully contained in previous — skip
      continue;
    }
    if (prev && entity.start < prev.end) {
      // Overlapping — keep the longer one
      if (entity.end - entity.start > prev.end - prev.start) {
        result[result.length - 1] = entity;
      }
      continue;
    }
    result.push(entity);
  }

  return result;
}
