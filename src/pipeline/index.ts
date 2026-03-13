/**
 * The complete redaction pipeline.
 *
 * This orchestrates: image → OCR → NER + regex → span→bbox bridge → redactions.
 * All processing happens in the browser. Nothing is sent to any server.
 */

import type {
  OcrResult,
  PiiEntity,
  ProgressEvent,
  Redaction,
  RedactorConfig,
} from "../types.js";
import { runOcr } from "./ocr.js";
import { detectPiiNer, releaseNerModel } from "./pii-ner.js";
import { detectPiiRegex } from "./pii-regex.js";
import { entitiesToRedactions, mergeEntities } from "./bridge.js";

export { runOcr } from "./ocr.js";
export { detectPiiNer, preloadNerModel, releaseNerModel } from "./pii-ner.js";
export { detectPiiRegex } from "./pii-regex.js";
export { entitiesToRedactions, mergeEntities } from "./bridge.js";
export { renderRedactedImage, drawRedactionPreview } from "./redact.js";
export { preprocessForOcr, computeAverageLuminance, isDarkBackground, DARK_THRESHOLD } from "./preprocess.js";

/**
 * Run the full pipeline: OCR → PII detection → redaction mapping.
 *
 * Returns the OCR text, detected entities, and proposed redaction boxes.
 * Does NOT render the final image — that happens when the user confirms.
 */
export async function analyzeImage(
  image: HTMLImageElement | ImageBitmap | Blob,
  config: RedactorConfig,
  onProgress?: (event: ProgressEvent) => void,
): Promise<{
  ocr: OcrResult;
  entities: PiiEntity[];
  redactions: Redaction[];
}> {
  const cfg = { ...config } as Required<RedactorConfig>;

  // Resolve memory mode: detect low-memory devices automatically
  const resolvedMemoryMode = resolveMemoryMode(cfg.memoryMode);

  // Step 1: OCR
  onProgress?.({ phase: "ocr", progress: 0, message: "Starting OCR..." });
  const ocr = await runOcr(image, cfg.lang, onProgress);

  if (!ocr.fullText.trim()) {
    return { ocr, entities: [], redactions: [] };
  }

  // Step 2: PII detection (NER + regex in parallel)
  onProgress?.({
    phase: "detecting",
    progress: 0,
    message: "Detecting personal information...",
  });

  const regexEntities = cfg.useRegex ? detectPiiRegex(ocr.fullText) : [];

  // In low-memory mode, release any cached NER model before loading a fresh
  // one — this avoids holding two large model allocations simultaneously.
  // (The OCR worker was already terminated in runOcr's finally block.)
  if (resolvedMemoryMode === "low") {
    await releaseNerModel();
  }

  // Run NER (async, slower)
  const nerEntities = await detectPiiNer(ocr.fullText, cfg.nerModel, cfg.minConfidence, onProgress);

  // Step 3: Merge and deduplicate
  const entities = mergeEntities(nerEntities, regexEntities);

  // Step 4: Map to image bounding boxes
  const redactions = entitiesToRedactions(entities, ocr.words, ocr.imageWidth, ocr.imageHeight);

  onProgress?.({
    phase: "reviewing",
    progress: 1,
    message: `Found ${redactions.length} items to redact.`,
  });

  return { ocr, entities, redactions };
}

/**
 * Determine the effective memory mode.
 *
 * "auto" uses `navigator.deviceMemory` (Chrome/Edge only; undefined elsewhere).
 * When the API is unavailable we default to "normal" to avoid unnecessary
 * sequential delays on desktop browsers that don't expose memory info.
 */
function resolveMemoryMode(mode: Required<RedactorConfig>["memoryMode"]): "low" | "normal" {
  if (mode === "low") return "low";
  if (mode === "normal") return "normal";

  // "auto": probe the device memory API
  const deviceMemory = (navigator as any).deviceMemory as number | undefined;
  if (deviceMemory !== undefined && deviceMemory < 4) {
    return "low";
  }
  return "normal";
}
