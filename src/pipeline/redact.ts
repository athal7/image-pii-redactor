import type { BBox, Redaction, RedactionResult } from "../types.js";

/**
 * Render the original image with redaction boxes burned in.
 * Returns a PNG blob ready for upload.
 *
 * This is intentionally simple: draw the image, then fill black rectangles.
 * The simplicity is a feature — it's trivially auditable for a privacy tool.
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
