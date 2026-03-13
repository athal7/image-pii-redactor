import type { BBox, Redaction } from "../types.js";

/**
 * NER labels that indicate a person name — avatar search is anchored to these.
 */
const PERSON_LABELS = new Set(["GIVENNAME", "SURNAME", "PERSON"]);

/**
 * Pixel color variance threshold above which a region is considered
 * "visually distinct from a plain background" (i.e. likely an avatar).
 *
 * Pure-white regions have variance 0. Photo avatars and initial-on-color
 * avatars typically exceed 5000. Calibrated against real chat screenshots.
 */
const VARIANCE_THRESHOLD = 3000;

/**
 * How far to the left of the name bbox to search, expressed as a multiple
 * of the name line height. Chat avatars are typically 1–3× the text height.
 */
const SEARCH_WIDTH_FACTOR = 4;

/**
 * Vertical padding around the name bbox when constructing the search area,
 * as a fraction of the line height. Avatars often extend above/below the text.
 */
const VERTICAL_PAD_FACTOR = 1.5;

let avatarIdCounter = 0;

/**
 * Detects probable avatar image regions by searching to the left of detected
 * person-name redactions.
 *
 * This is an OCR-guided spatial heuristic: rather than scanning the whole
 * image for faces (expensive, misses initial avatars), we anchor the search
 * to NER-detected name positions. Chat UIs consistently place avatars
 * immediately to the left of the sender name.
 *
 * @param nameRedactions - Redactions from the NER/compromise stage
 * @param imageWidth     - Full image width (px), used to clamp search bounds
 * @param imageHeight    - Full image height (px), used to clamp search bounds
 * @param getPixelVariance - Returns the per-channel color variance for a bbox
 *   region. Pass a Canvas-backed implementation in production; inject a mock
 *   in tests. Variance of 0 = uniform color (background); high = image content.
 */
export function detectAvatars(
  nameRedactions: Redaction[],
  imageWidth: number,
  imageHeight: number,
  getPixelVariance: (bbox: BBox) => number,
): Redaction[] {
  const avatars: Redaction[] = [];

  // Deduplicate by approximate line: multiple name-part redactions on the same
  // visual line should only trigger one avatar search.
  // Key = rounded vertical center of the name bbox (±20px tolerance).
  const checkedLines = new Set<number>();

  // Filter to person-label redactions only, sorted left-to-right so we always
  // use the leftmost word on each line as the anchor.
  const personRedactions = nameRedactions
    .filter((r) => r.label && PERSON_LABELS.has(r.label))
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);

  for (const redaction of personRedactions) {
    const { bbox } = redaction;
    const lineHeight = bbox.y1 - bbox.y0;
    const lineKey = Math.round((bbox.y0 + bbox.y1) / 2 / 20); // 20px buckets

    if (checkedLines.has(lineKey)) continue;
    checkedLines.add(lineKey);

    // Don't bother if the name is already near the left edge
    const searchWidth = lineHeight * SEARCH_WIDTH_FACTOR;
    if (bbox.x0 < searchWidth * 0.5) continue;

    // Build the search area: a rectangle to the left of the name
    const vPad = lineHeight * VERTICAL_PAD_FACTOR;
    const searchArea: BBox = {
      x0: Math.max(0, bbox.x0 - searchWidth),
      y0: Math.max(0, bbox.y0 - vPad),
      x1: bbox.x0,
      y1: Math.min(imageHeight, bbox.y1 + vPad),
    };

    const variance = getPixelVariance(searchArea);

    if (variance < VARIANCE_THRESHOLD) continue;

    // Estimate the avatar bbox: square region, sized to the search area height,
    // flush against the right edge of the search area (immediately left of name).
    const avatarSize = searchArea.y1 - searchArea.y0;
    const avatarBbox: BBox = {
      x0: Math.max(0, searchArea.x1 - avatarSize),
      y0: searchArea.y0,
      x1: searchArea.x1,
      y1: searchArea.y1,
    };

    avatars.push({
      id: `avatar-${avatarIdCounter++}`,
      bbox: avatarBbox,
      source: "auto",
      enabled: true,
      label: "AVATAR",
    });
  }

  return avatars;
}

/**
 * Build the getPixelVariance function backed by a real Canvas context.
 *
 * Called once per image in the pipeline, returning a closure over the drawn
 * canvas so we only pay the drawImage cost once.
 */
export function makeCanvasVarianceFn(
  image: ImageBitmap | HTMLImageElement,
  imageWidth: number,
  imageHeight: number,
): (bbox: BBox) => number {
  const canvas = new OffscreenCanvas(imageWidth, imageHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);

  return (bbox: BBox): number => {
    const w = Math.max(1, Math.round(bbox.x1 - bbox.x0));
    const h = Math.max(1, Math.round(bbox.y1 - bbox.y0));
    const x = Math.max(0, Math.round(bbox.x0));
    const y = Math.max(0, Math.round(bbox.y0));

    const data = ctx.getImageData(x, y, w, h).data;
    let r = 0, g = 0, b = 0;
    const count = w * h;

    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }

    const avgR = r / count;
    const avgG = g / count;
    const avgB = b / count;
    let variance = 0;

    for (let i = 0; i < data.length; i += 4) {
      variance +=
        (data[i] - avgR) ** 2 +
        (data[i + 1] - avgG) ** 2 +
        (data[i + 2] - avgB) ** 2;
    }

    return variance / count;
  };
}
