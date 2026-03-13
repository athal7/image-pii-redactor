import type { OcrResult, OcrWord, ProgressEvent } from "../types.js";
import { preprocessForOcr } from "./preprocess.js";

/**
 * Runs Tesseract.js OCR on an image, returning word-level bounding boxes
 * with character offsets into the reconstructed full text.
 *
 * Tesseract.js manages its own Web Worker internally.
 */
export async function runOcr(
  image: ImageBitmap | HTMLImageElement | Blob,
  lang: string = "eng",
  onProgress?: (event: ProgressEvent) => void,
): Promise<OcrResult> {
  // Dynamic import — Tesseract.js is heavy, only load when needed
  const Tesseract = await import("tesseract.js");

  const worker = await Tesseract.createWorker(lang, undefined, {
    logger: (m: { status: string; progress: number }) => {
      onProgress?.({
        phase: "ocr",
        progress: m.progress,
        message: m.status,
      });
    },
  });

  // Get the image source as a Blob so we can pre-process it.
  // Also capture dimensions now — Tesseract doesn't always expose them.
  let rawBlob: Blob;
  let knownWidth = 0;
  let knownHeight = 0;

  if (image instanceof ImageBitmap) {
    knownWidth = image.width;
    knownHeight = image.height;
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    rawBlob = await canvas.convertToBlob({ type: "image/png" });
  } else if (image instanceof Blob) {
    // Decode to get dimensions, then pass original blob for pre-processing
    try {
      const bmp = await createImageBitmap(image);
      knownWidth = bmp.width;
      knownHeight = bmp.height;
      bmp.close();
    } catch {
      // Non-fatal: dimensions stay 0, Tesseract fallback will fill them
    }
    rawBlob = image;
  } else {
    // HTMLImageElement
    knownWidth = image.naturalWidth;
    knownHeight = image.naturalHeight;
    const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    rawBlob = await canvas.convertToBlob({ type: "image/png" });
  }

  // Pre-process: invert dark backgrounds, boost contrast
  const source = await preprocessForOcr(rawBlob);

  let result: Awaited<ReturnType<typeof worker.recognize>>;
  try {
    result = await worker.recognize(source);
  } finally {
    // Always terminate the worker — even on error — to prevent memory leaks
    await worker.terminate();
  }

  // Build word index with cumulative character offsets.
  // We reconstruct the full text by joining words with spaces within a line,
  // and lines with newlines.
  const words: OcrWord[] = [];
  let fullText = "";
  let charOffset = 0;

  const lines = result.data.lines ?? [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineWords = line.words ?? [];

    for (let wi = 0; wi < lineWords.length; wi++) {
      const w = lineWords[wi];
      const text = w.text;
      const charStart = charOffset;
      const charEnd = charOffset + text.length;

      words.push({
        text,
        bbox: {
          x0: w.bbox.x0,
          y0: w.bbox.y0,
          x1: w.bbox.x1,
          y1: w.bbox.y1,
        },
        confidence: w.confidence,
        charStart,
        charEnd,
        lineIndex,
      });

      fullText += text;
      charOffset += text.length;

      // Add space between words within a line
      if (wi < lineWords.length - 1) {
        fullText += " ";
        charOffset += 1;
      }
    }

    // Add newline between lines
    if (lineIndex < lines.length - 1) {
      fullText += "\n";
      charOffset += 1;
    }
  }

  // Determine image dimensions: prefer Tesseract's values, fall back to
  // the dimensions we captured before pre-processing.
  const data = result.data as any;
  const imageWidth: number = data.imageWidth ?? knownWidth;
  const imageHeight: number = data.imageHeight ?? knownHeight;

  return { fullText, words, imageWidth, imageHeight };
}

/**
 * Given a character span (start, end) in the full text, find all words
 * whose character ranges overlap with that span.
 */
export function findWordsInSpan(
  words: OcrWord[],
  start: number,
  end: number,
): OcrWord[] {
  return words.filter((w) => w.charStart < end && w.charEnd > start);
}
