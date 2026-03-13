/**
 * Image pre-processing for OCR accuracy improvement.
 *
 * Dark-background screenshots (dark-mode chat UIs, blue chat bubbles) make
 * Tesseract miss text because it expects dark text on a light background.
 *
 * This module:
 *  1. Samples the image to detect if the background is dark
 *  2. If dark: inverts the image so text becomes dark-on-light
 *  3. Boosts contrast to sharpen text edges
 *
 * All processing is done on an OffscreenCanvas — no data leaves the browser.
 */

/** Luminance threshold below which a background is considered "dark". */
export const DARK_THRESHOLD = 128;

/**
 * The number of grid divisions used when sampling pixels for background
 * darkness detection. A 5×5 grid gives 25 evenly-distributed sample regions
 * spread across the full image, ensuring mixed-layout images (e.g. a white
 * document on the left and a dark chat panel on the right) are detected
 * correctly instead of only sampling the top-left corner.
 */
const SAMPLE_GRID_COLS = 5;
const SAMPLE_GRID_ROWS = 5;
/** Size of each sampled patch in pixels. */
const SAMPLE_PATCH_SIZE = 8;

/**
 * Sample pixels from a distributed grid across the full image and concatenate
 * them into a single RGBA Uint8ClampedArray for luminance analysis.
 *
 * This replaces the previous approach of sampling only a rectangle anchored
 * at the top-left corner, which would always return "light" for images with
 * a white document panel on the left regardless of the rest of the image.
 *
 * Exported for unit testing.
 */
export function sampleDistributedPixels(
  ctx: Pick<CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, "getImageData">,
  width: number,
  height: number,
): Uint8ClampedArray {
  const patchSize = Math.min(SAMPLE_PATCH_SIZE, width, height);
  const patches: Uint8ClampedArray[] = [];

  for (let gy = 0; gy < SAMPLE_GRID_ROWS; gy++) {
    for (let gx = 0; gx < SAMPLE_GRID_COLS; gx++) {
      // Distribute patch origins evenly across the full image
      const sx = Math.floor((gx / SAMPLE_GRID_COLS) * (width - patchSize));
      const sy = Math.floor((gy / SAMPLE_GRID_ROWS) * (height - patchSize));
      const patch = ctx.getImageData(sx, sy, patchSize, patchSize);
      patches.push(patch.data);
    }
  }

  // Concatenate all patch pixel arrays into a single buffer
  const totalLength = patches.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8ClampedArray(totalLength);
  let offset = 0;
  for (const patch of patches) {
    combined.set(patch, offset);
    offset += patch.length;
  }
  return combined;
}

/**
 * Compute the perceived average luminance of an RGBA pixel buffer.
 *
 * Uses the ITU-R BT.601 luma coefficients:
 *   Y = 0.299R + 0.587G + 0.114B
 *
 * Returns a value in [0, 255], or 255 if the buffer is empty (treat as light).
 */
export function computeAverageLuminance(pixels: Uint8ClampedArray): number {
  const pixelCount = Math.floor(pixels.length / 4);
  if (pixelCount === 0) return 255; // No data → treat as light background

  let total = 0;
  for (let i = 0; i < pixelCount; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    // Perceived luminance (ITU-R BT.601)
    total += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return total / pixelCount;
}

/**
 * Return true if the pixel data represents a dark-background image.
 */
export function isDarkBackground(pixels: Uint8ClampedArray): boolean {
  return computeAverageLuminance(pixels) < DARK_THRESHOLD;
}

/**
 * Pre-process an image for better OCR accuracy.
 *
 * - If the background is dark, inverts the image.
 * - Applies a mild contrast boost (factor 1.4) to sharpen text edges.
 *
 * Returns a Blob (PNG) suitable for passing to Tesseract.js.
 * Falls back to the original Blob if canvas is unavailable.
 */
export async function preprocessForOcr(
  source: Blob,
): Promise<Blob> {
  // Use OffscreenCanvas when available (Worker + main thread), fall back to
  // regular canvas in environments that don't support it (e.g. jsdom tests).
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  try {
    // Decode the image
    const imageBitmap = await createImageBitmap(source);
    const { width, height } = imageBitmap;

    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    } else {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    }

    if (!ctx) {
      imageBitmap.close();
      return source; // Canvas not available — return original
    }

    // Draw original image
    ctx.drawImage(imageBitmap, 0, 0);
    imageBitmap.close();

    // Sample pixels to detect background darkness using a distributed grid
    // across the full image. Previously this only sampled the top-left corner,
    // which gave wrong results for mixed-layout images (e.g. a white document
    // panel on the left and a dark chat panel on the right).
    const sampledPixels = sampleDistributedPixels(ctx, width, height);
    const dark = isDarkBackground(sampledPixels);

    if (!dark) {
      // Light background — no inversion needed, still apply mild contrast
      return await applyContrast(canvas, ctx, width, height, 1.2);
    }

    // Dark background — invert the image first, then boost contrast
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      data[i]     = 255 - data[i];     // R
      data[i + 1] = 255 - data[i + 1]; // G
      data[i + 2] = 255 - data[i + 2]; // B
      // Alpha unchanged
    }

    ctx.putImageData(imageData, 0, 0);

    // Boost contrast after inversion (1.5 is stronger for previously-dark text)
    return await applyContrast(canvas, ctx, width, height, 1.5);
  } catch {
    // If anything fails (e.g. corrupt image), return original
    return source;
  }
}

/**
 * Apply a contrast boost to the canvas content.
 *
 * Uses the standard contrast formula:
 *   pixel' = (pixel - 128) * factor + 128
 *
 * Returns a PNG Blob.
 */
async function applyContrast(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
  factor: number,
): Promise<Blob> {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = clamp((data[i]     - 128) * factor + 128);
    data[i + 1] = clamp((data[i + 1] - 128) * factor + 128);
    data[i + 2] = clamp((data[i + 2] - 128) * factor + 128);
    // Alpha unchanged
  }

  ctx.putImageData(imageData, 0, 0);

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/png" });
  } else {
    return await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob returned null"));
      }, "image/png");
    });
  }
}

/** Clamp a number to [0, 255] and round. */
function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
