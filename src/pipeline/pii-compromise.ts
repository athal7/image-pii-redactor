/**
 * Compromise-based person name detection.
 *
 * Uses the `compromise` NLP library's lexicon-driven people() extractor as a
 * third detection source alongside NER and regex. This catches names that both
 * NER and regex miss:
 *
 *   - Lowercase casual usage:  "thanks alice for the update"
 *   - All-caps OCR artifacts:  "ALICE NGUYEN\n3:15 PM Yesterday"
 *   - Hyphenated names:        "al-hassan approved the PR"
 *   - Non-dictionary names:    handled via context (surrounding pronouns, verbs)
 *
 * compromise uses a ~14k-word lexicon that knows common first/last names
 * (#FirstName → #Person → #ProperNoun), so it correctly skips org names like
 * "Mozilla Foundation" that a capitalization-based regex would flag.
 *
 * Bundle cost: ~131kb gzip — negligible next to the 80MB NER model.
 */

import nlp from "compromise";
import type { PiiEntity } from "../types.js";

let idCounter = 0;

/**
 * Detect person names in OCR text using compromise's lexicon.
 * Returns PiiEntity[] with correct character offsets into the source text.
 */
export function detectPiiCompromise(text: string): PiiEntity[] {
  if (!text) return [];

  const doc = nlp(text);
  doc.compute("offset");

  const people = doc.people();
  if (!people.found) return [];

  const entities: PiiEntity[] = [];

  // compromise's .json() return type is not precise enough to type fully;
  // the {offset:true} option adds offset.start / offset.length per match.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const match of people.json({ offset: true }) as any[]) {
    const offset = match.offset;
    if (!offset || offset.start == null || offset.length == null) continue;

    const start = offset.start as number;
    const end = start + (offset.length as number);

    // Trim trailing punctuation that compromise sometimes absorbs
    // (e.g. "alice," when the name is followed by a comma)
    const raw = text.slice(start, end);
    const trimmed = raw.replace(/[,;:.!?]+$/, "");
    const trimmedEnd = start + trimmed.length;

    if (!trimmed) continue;

    entities.push({
      id: `compromise-${idCounter++}`,
      // "PERSON" rather than "GIVENNAME": compromise returns full names
      // (e.g. "Alice Nguyen"), not isolated first names. GIVENNAME would
      // display misleadingly as "First name" in the review UI.
      label: "PERSON",
      text: trimmed,
      start,
      end: trimmedEnd,
      // Score is intentionally below the minimum NER score after its +0.1
      // boost (0.7 + 0.1 = 0.8), so NER always wins when both detect the
      // same span. Compromise acts as a fallback when NER misses entirely.
      score: 0.75,
      source: "compromise",
    });
  }

  return entities;
}
