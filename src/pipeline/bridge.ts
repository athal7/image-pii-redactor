import type { BBox, OcrWord, PiiEntity, Redaction } from "../types.js";
import { findWordsInSpan } from "./ocr.js";

let redactionIdCounter = 0;

/**
 * The core bridge: maps PII entity character spans to image pixel bounding
 * boxes by finding which OCR words overlap each entity span, then merging
 * their bounding boxes.
 *
 * This is the piece that doesn't exist in any library — the connection
 * between text-domain PII detection and pixel-domain redaction.
 *
 * @param imageWidth  Used to clamp bbox x1 within image bounds (0 = no clamp)
 * @param imageHeight Used to clamp bbox y1 within image bounds (0 = no clamp)
 */
export function entitiesToRedactions(
  entities: PiiEntity[],
  words: OcrWord[],
  imageWidth: number = 0,
  imageHeight: number = 0,
): Redaction[] {
  const redactions: Redaction[] = [];

  for (const entity of entities) {
    // Skip entities without valid offsets
    if (entity.start == null || entity.end == null) {
      continue;
    }

    const overlapping = findWordsInSpan(words, entity.start, entity.end);

    // Fallback: if no words overlap by char offset, try fuzzy text matching
    let matchedWords = overlapping;
    if (matchedWords.length === 0 && entity.text) {
      matchedWords = findWordsByText(words, entity.text);
    }

    if (matchedWords.length === 0) {
      continue;
    }

    // Group overlapping words by line to avoid creating a single huge
    // bounding box that spans multiple lines
    const byLine = groupByLine(matchedWords);

    for (const lineWords of byLine.values()) {
      const merged = mergeBBoxes(lineWords.map((w) => w.bbox));
      redactions.push({
        id: `redact-${redactionIdCounter++}`,
        bbox: padBBox(merged, 2, imageWidth, imageHeight),
        source: "auto",
        entityId: entity.id,
        enabled: true,
        label: entity.label,
      });
    }
  }

  return redactions;
}

/**
 * Fallback: find words whose text matches (or contains) the entity text.
 * Used when character offset mapping fails.
 */
function findWordsByText(words: OcrWord[], entityText: string): OcrWord[] {
  const lower = entityText.toLowerCase().trim();
  if (!lower) return [];

  // Try to find a contiguous sequence of words that form the entity text
  const entityWords = lower.split(/\s+/);

  for (let i = 0; i <= words.length - entityWords.length; i++) {
    let match = true;
    for (let j = 0; j < entityWords.length; j++) {
      if (!words[i + j].text.toLowerCase().includes(entityWords[j]) &&
          !entityWords[j].includes(words[i + j].text.toLowerCase())) {
        match = false;
        break;
      }
    }
    if (match) {
      return words.slice(i, i + entityWords.length);
    }
  }

  // Single word match fallback
  const matched = words.filter((w) => {
    const wl = w.text.toLowerCase();
    return wl === lower || lower.includes(wl) || wl.includes(lower);
  });

  return matched;
}

/**
 * Gap threshold (px) beyond which two consecutive words on the same Tesseract
 * line are treated as belonging to separate visual columns.
 *
 * Chat UIs often render a two-column layout (sidebar + content) that Tesseract
 * collapses into a single line. A gap this large indicates the words are in
 * different columns and should be redacted separately.
 */
const COLUMN_GAP_THRESHOLD_PX = 200;

/**
 * Group words into spatial clusters for redaction. Each cluster becomes one
 * bounding box.
 *
 * Words are first split by Tesseract line index. Within each line, they are
 * further split when consecutive words have an x-gap larger than
 * COLUMN_GAP_THRESHOLD_PX. This prevents cross-column OCR artifacts (e.g.
 * "Alice Nguyen ee" where "ee" is from the right column) from producing a
 * single giant bbox that spans the full width of the image.
 *
 * Returns a flat list of word groups, each guaranteed to be spatially coherent.
 */
function groupByLine(words: OcrWord[]): Map<number, OcrWord[]> {
  // First pass: group by Tesseract line index
  const byLine = new Map<number, OcrWord[]>();
  for (const word of words) {
    const group = byLine.get(word.lineIndex) ?? [];
    group.push(word);
    byLine.set(word.lineIndex, group);
  }

  // Second pass: split each line group further on large horizontal gaps.
  // We use a synthetic compound key (lineIndex * 10000 + segmentIndex) so the
  // output Map keys remain unique numbers, compatible with the callers that
  // only iterate values.
  const result = new Map<number, OcrWord[]>();
  let segmentCounter = 0;

  for (const [lineIndex, lineWords] of byLine) {
    // Sort words left-to-right within the line
    const sorted = [...lineWords].sort((a, b) => a.bbox.x0 - b.bbox.x0);

    let currentGroup: OcrWord[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const gap = curr.bbox.x0 - prev.bbox.x1;

      if (gap > COLUMN_GAP_THRESHOLD_PX) {
        // Large gap → flush current group and start a new one
        result.set(lineIndex * 10000 + segmentCounter++, currentGroup);
        currentGroup = [curr];
      } else {
        currentGroup.push(curr);
      }
    }
    result.set(lineIndex * 10000 + segmentCounter++, currentGroup);
  }

  return result;
}

/**
 * Merge an array of bounding boxes into a single box that contains all of them.
 */
function mergeBBoxes(boxes: BBox[]): BBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/**
 * Add padding to a bounding box, clamped to image bounds.
 *
 * @param maxW  Image width (0 = no upper clamp on x)
 * @param maxH  Image height (0 = no upper clamp on y)
 */
function padBBox(bbox: BBox, padding: number, maxW: number = 0, maxH: number = 0): BBox {
  const x1 = bbox.x1 + padding;
  const y1 = bbox.y1 + padding;
  return {
    x0: Math.max(0, bbox.x0 - padding),
    y0: Math.max(0, bbox.y0 - padding),
    x1: maxW > 0 ? Math.min(maxW, x1) : x1,
    y1: maxH > 0 ? Math.min(maxH, y1) : y1,
  };
}

/**
 * Merge entities from NER and regex, deduplicating overlapping spans.
 * When NER and regex detect the same span, prefer the NER result
 * (it has a more specific label).
 */
export function mergeEntities(
  nerEntities: PiiEntity[],
  regexEntities: PiiEntity[],
): PiiEntity[] {
  const all = [...nerEntities, ...regexEntities];
  all.sort((a, b) => a.start - b.start || b.end - a.end);

  const result: PiiEntity[] = [];

  for (const entity of all) {
    const prev = result[result.length - 1];
    if (!prev) {
      result.push(entity);
      continue;
    }

    // Check for overlap
    if (entity.start < prev.end) {
      // Overlapping — keep the one with higher confidence,
      // preferring NER over regex when scores are close
      const prevScore = prev.source === "ner" ? prev.score + 0.1 : prev.score;
      const currScore =
        entity.source === "ner" ? entity.score + 0.1 : entity.score;

      if (currScore > prevScore) {
        result[result.length - 1] = entity;
      }
      continue;
    }

    result.push(entity);
  }

  return result;
}
