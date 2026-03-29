import type { OcrResult, PiiEntity, Redaction, RedactionResult } from "../types.js";

// ── PNG metadata utilities ────────────────────────────────────────────────────

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Parse the chunk type names from a PNG byte stream.
 *
 * Used to verify that exported blobs contain no metadata chunks (tEXt, iTXt,
 * zTXt, eXIf, tIME, etc.). Returns an empty array if the buffer is not a
 * valid PNG.
 *
 * Metadata stripping guarantee
 * ─────────────────────────────
 * The canvas round-trip (drawImage → toBlob/convertToBlob with "image/png")
 * produces a blob that contains only raw pixel data. All ancillary chunks
 * present in the original file — EXIF, XMP, GPS, timestamps, comments — are
 * silently discarded by the browser's PNG encoder. This function exists so
 * that guarantee can be verified in tests.
 */
export function parsePngChunkNames(bytes: Uint8Array): string[] {
  // Validate PNG signature
  if (bytes.length < PNG_SIGNATURE.length) return [];
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return [];
  }

  const decoder = new TextDecoder("latin1");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= bytes.length) {
    const dataLength = view.getUint32(offset, false);
    const typeBytes = bytes.slice(offset + 4, offset + 8);
    const typeName = decoder.decode(typeBytes);
    names.push(typeName);
    if (typeName === "IEND") break;
    // 4 (length) + 4 (type) + dataLength (data) + 4 (CRC)
    offset += 4 + 4 + dataLength + 4;
  }

  return names;
}

// ── Redaction rendering ───────────────────────────────────────────────────────

/**
 * Render the original image with redaction boxes burned in.
 * Returns a PNG blob ready for upload.
 *
 * This is intentionally simple: draw the image, then fill black rectangles.
 * The simplicity is a feature — it's trivially auditable for a privacy tool.
 *
 * Metadata stripping
 * ───────────────────
 * The canvas → PNG round-trip strips all metadata from the original image.
 * EXIF data, XMP, GPS coordinates, device/software info, and timestamps are
 * all discarded by the browser's PNG encoder. The output blob contains only
 * pixel data. Use `parsePngChunkNames` to verify this programmatically.
 */
export async function renderRedactedImage(
  originalImage: HTMLImageElement | ImageBitmap,
  redactions: Redaction[],
): Promise<RedactionResult> {
  const width =
    originalImage instanceof HTMLImageElement
      ? originalImage.naturalWidth
      : originalImage.width;
  const height =
    originalImage instanceof HTMLImageElement
      ? originalImage.naturalHeight
      : originalImage.height;

  // Use OffscreenCanvas if available (better for memory on mobile),
  // fall back to regular canvas
  const canvas = createCanvas(width, height);
  const ctx = getContext(canvas);

  // Draw original image
  ctx.drawImage(originalImage, 0, 0, width, height);

  // Draw black rectangles over enabled redactions
  ctx.fillStyle = "#000000";
  const appliedEntities: RedactionResult["entities"] = [];

  for (const redaction of redactions) {
    if (!redaction.enabled) continue;

    const { x0, y0, x1, y1 } = redaction.bbox;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    appliedEntities.push({
      label: redaction.label ?? "UNKNOWN",
      bbox: redaction.bbox,
      source: redaction.source,
    });
  }

  // Export as PNG
  const blob = await canvasToBlob(canvas);

  return {
    blob,
    entities: appliedEntities,
    width,
    height,
    redactedText: "",
  };
}

/**
 * Quick preview: draw redaction boxes onto an existing canvas context.
 * Used for the live preview in the review phase (not for export).
 */
export function drawRedactionPreview(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  redactions: Redaction[],
  style: { fill: string; stroke: string; lineWidth: number } = {
    fill: "rgba(0, 0, 0, 0.7)",
    stroke: "#ff3333",
    lineWidth: 2,
  },
): void {
  for (const redaction of redactions) {
    if (!redaction.enabled) continue;

    const { x0, y0, x1, y1 } = redaction.bbox;
    const w = x1 - x0;
    const h = y1 - y0;

    ctx.fillStyle = style.fill;
    ctx.fillRect(x0, y0, w, h);

    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    ctx.strokeRect(x0, y0, w, h);
  }
}

// ── Redacted text reconstruction ──────────────────────────────────────────────

/**
 * Reconstruct the OCR full text with PII words replaced by `[REDACTED]`.
 *
 * Adjacent redacted words **on the same line** are collapsed into a single
 * `[REDACTED]` token to avoid repeated markers for multi-word entities.
 * Words on different lines each receive their own token, preserving the
 * newline between them.
 *
 * @param ocrResult  - The OCR output. When null, returns `""`.
 * @param redactions - All redaction boxes (only enabled ones are applied).
 * @param entities   - PII entities used to look up char spans via `entityId`.
 */
export function buildRedactedText(
  ocrResult: OcrResult | null,
  redactions: Redaction[],
  entities: PiiEntity[],
): string {
  if (ocrResult === null) return "";

  const { fullText, words } = ocrResult;

  // Build a fast lookup: entity id → entity
  const entityById = new Map<string, PiiEntity>(entities.map((e) => [e.id, e]));

  // Collect the set of word indices that should be redacted
  const redactedIndices = new Set<number>();

  for (const redaction of redactions) {
    if (!redaction.enabled) continue;
    // AVATAR redactions are image regions — they have no text to redact
    if (redaction.label === "AVATAR") continue;

    if (redaction.entityId !== undefined) {
      // Entity-based redaction: find all words whose char span overlaps the entity
      const entity = entityById.get(redaction.entityId);
      if (!entity) continue;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.charStart < entity.end && w.charEnd > entity.start) {
          redactedIndices.add(i);
        }
      }
    } else {
      // Manual redaction (no entityId): find words whose bbox intersects
      const r = redaction.bbox;
      for (let i = 0; i < words.length; i++) {
        const w = words[i].bbox;
        if (w.x0 < r.x1 && w.x1 > r.x0 && w.y0 < r.y1 && w.y1 > r.y0) {
          redactedIndices.add(i);
        }
      }
    }
  }

  // Cursor-based reconstruction: walk words in order, preserving spacing from
  // fullText, merging adjacent redacted words on the same line.
  let result = "";
  let cursor = 0;
  let inRedactedRun = false;
  let lastRedactedLineIndex = -1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const gap = fullText.slice(cursor, word.charStart);

    if (redactedIndices.has(i)) {
      if (inRedactedRun && word.lineIndex === lastRedactedLineIndex) {
        // Same line, same run — skip word and its preceding gap
      } else {
        // New redaction run or different line: emit gap then token
        result += gap;
        result += "[REDACTED]";
        inRedactedRun = true;
        lastRedactedLineIndex = word.lineIndex;
      }
    } else {
      result += gap;
      result += word.text;
      inRedactedRun = false;
    }

    cursor = word.charEnd;
  }

  // Append any trailing text after the last word (e.g. trailing newline)
  result += fullText.slice(cursor);
  return result;
}

// --- Canvas helpers (abstract over OffscreenCanvas / HTMLCanvasElement) ---

function createCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getContext(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  return ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/png",
    );
  });
}
