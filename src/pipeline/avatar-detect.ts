import type { BBox, Redaction } from "../types.js";

/**
 * NER labels that indicate a person name — avatar search is anchored to these.
 */
const PERSON_LABELS = new Set(["GIVENNAME", "SURNAME", "PERSON"]);

/**
 * How far left of the name bbox to scan for an avatar, as a multiple of the
 * name line height. Real chat avatars are 2–5× the text line height away.
 */
const MAX_SCAN_FACTOR = 8;

/**
 * Minimum gap width (px) between the avatar and the name. A gap of at least
 * this many background-colored columns must exist immediately left of the name.
 * Prevents matching text that runs right up to the name with no whitespace.
 */
const MIN_GAP_PX = 5;

/**
 * The avatar dark region must be at least this many pixels wide (measured in
 * columns). Sized relative to line height to be scale-independent.
 * Expressed as a fraction of line height (so a 22px line → min 11px wide).
 */
const MIN_AVATAR_WIDTH_FACTOR = 0.5;

/**
 * Background column brightness threshold: columns brighter than this are
 * considered "background" (white / light-grey page). Columns dimmer than
 * this are "content" (avatar photo or text).
 */
const BG_BRIGHTNESS = 230;

/**
 * Maximum average brightness of the dark region for it to qualify as an
 * avatar. Avatar photos are always meaningfully darker than the page
 * background. This rejects near-white or very light regions.
 */
const MAX_AVATAR_BRIGHTNESS = 210;

let avatarIdCounter = 0;

/**
 * Detects probable avatar image regions by searching to the left of detected
 * person-name redactions.
 *
 * Algorithm: for each person-name redaction, scan columns left from the name's
 * x0. Look for the pattern [name] [bright gap ≥5px] [dark region ≥½ lineH] —
 * this is the signature of a chat avatar: a photo/initial-circle separated from
 * the sender name by whitespace. Continuous text (false positives) runs right
 * up to the name with no gap, and fails the MIN_GAP_PX check.
 *
 * @param nameRedactions    - Redactions from NER/compromise (all labels)
 * @param imageWidth        - Full image width in pixels
 * @param imageHeight       - Full image height in pixels
 * @param getColumnBrightness - Returns the mean brightness (0-255) of all
 *   pixels in column x between y=y0 and y=y1. Inject a Canvas-backed
 *   implementation in production; use a mock in tests.
 */
export function detectAvatars(
  nameRedactions: Redaction[],
  imageWidth: number,
  imageHeight: number,
  getColumnBrightness: (x: number, y0: number, y1: number) => number,
): Redaction[] {
  const avatars: Redaction[] = [];

  // Deduplicate by approximate line (20px vertical buckets) so multiple
  // name-part redactions on the same line trigger only one avatar search.
  const checkedLines = new Set<number>();

  // Only search near person-label redactions; sort left-to-right so we use
  // the leftmost anchor on each line.
  const personRedactions = nameRedactions
    .filter((r) => r.label && PERSON_LABELS.has(r.label))
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);

  for (const redaction of personRedactions) {
    const { bbox } = redaction;
    const lineHeight = bbox.y1 - bbox.y0;
    const lineKey = Math.round((bbox.y0 + bbox.y1) / 2 / 20);

    if (checkedLines.has(lineKey)) continue;
    checkedLines.add(lineKey);

    // Skip names that are too close to the left image edge
    const maxScanPx = Math.round(lineHeight * MAX_SCAN_FACTOR);
    if (bbox.x0 < maxScanPx * 0.25) continue;

    const scanX0 = Math.max(0, bbox.x0 - maxScanPx);
    const scanY0 = Math.max(0, bbox.y0);
    const scanY1 = Math.min(imageHeight, bbox.y1);

    // Scan columns left from the name, looking for: [gap] [dark region]
    let gapWidth = 0;
    let darkStart = -1;
    let darkEnd = -1;
    let state: "gap" | "dark" | "done" = "gap";

    for (let x = bbox.x0 - 1; x >= scanX0; x--) {
      const brightness = getColumnBrightness(x, scanY0, scanY1);

      if (state === "gap") {
        if (brightness >= BG_BRIGHTNESS) {
          gapWidth++;
        } else {
          // Transition: gap ended, dark region begins
          state = "dark";
          darkEnd = x;
          darkStart = x;
        }
      } else if (state === "dark") {
        if (brightness < BG_BRIGHTNESS) {
          darkStart = x; // extend dark region leftward
        } else {
          // Transition: dark region ended (we hit background again on the left)
          state = "done";
          break;
        }
      }
    }

    // If we scanned all the way to scanX0 and were still in dark, clamp
    if (state === "dark") {
      darkStart = scanX0;
    }

    // Evaluate the found pattern
    if (gapWidth < MIN_GAP_PX) continue;
    if (darkEnd < 0 || darkStart < 0) continue;

    const darkWidth = darkEnd - darkStart + 1;
    const minWidth = Math.round(lineHeight * MIN_AVATAR_WIDTH_FACTOR);
    if (darkWidth < minWidth) continue;

    // Check average brightness of the dark region to reject near-white regions
    let brightnessSum = 0;
    for (let x = darkStart; x <= darkEnd; x++) {
      brightnessSum += getColumnBrightness(x, scanY0, scanY1);
    }
    const avgDarkBrightness = brightnessSum / darkWidth;
    if (avgDarkBrightness > MAX_AVATAR_BRIGHTNESS) continue;

    // Expand the avatar bbox vertically to include the typical avatar height
    // (avatars extend above and below the text line)
    const vPad = Math.round(lineHeight * 1.5);
    const avatarBbox: BBox = {
      x0: darkStart,
      y0: Math.max(0, bbox.y0 - vPad),
      x1: darkEnd + gapWidth + 1, // include the gap (blank space is part of avatar area)
      y1: Math.min(imageHeight, bbox.y1 + vPad),
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
 * Build the getColumnBrightness function backed by a real Canvas context.
 *
 * Returns the mean brightness of all pixels in column x, vertically from y0 to y1.
 * Draws the image once and reuses the pixel data for subsequent queries.
 */
export function makeCanvasColumnFn(
  image: ImageBitmap | HTMLImageElement,
  imageWidth: number,
  imageHeight: number,
): (x: number, y0: number, y1: number) => number {
  const canvas = new OffscreenCanvas(imageWidth, imageHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);

  // Cache the full image pixel data to avoid repeated getImageData calls
  const imageData = ctx.getImageData(0, 0, imageWidth, imageHeight);
  const pixels = imageData.data;

  return (x: number, y0: number, y1: number): number => {
    const col = Math.max(0, Math.min(imageWidth - 1, Math.round(x)));
    const top = Math.max(0, Math.round(y0));
    const bottom = Math.min(imageHeight, Math.round(y1));
    if (top >= bottom) return 255;

    let sum = 0;
    for (let y = top; y < bottom; y++) {
      const i = (y * imageWidth + col) * 4;
      sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    }
    return sum / (bottom - top);
  };
}
