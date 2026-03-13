import type { PiiEntity, ProgressEvent } from "../types.js";

// Singleton pipeline — loaded once, reused across calls.
// This avoids re-downloading the model on every invocation.
let pipelineInstance: any = null;
let pipelineModelId: string | null = null;

interface RawNerToken {
  entity: string;
  entity_group?: string;
  score: number;
  word: string;
  start: number | null;
  end: number | null;
  index?: number;
}

/**
 * Run NER-based PII detection using Transformers.js.
 *
 * Uses the token-classification pipeline with the specified model.
 * WebGPU is attempted first, falling back to WASM.
 */
export async function detectPiiNer(
  text: string,
  modelId: string,
  minConfidence: number = 0.7,
  onProgress?: (event: ProgressEvent) => void,
): Promise<PiiEntity[]> {
  const pipeline = await loadPipeline(modelId, onProgress);

  onProgress?.({
    phase: "detecting",
    progress: 0,
    message: "Running PII detection...",
  });

  // Try aggregation strategies in order of preference.
  // "first" is the most conservative (uses first token's label for a span),
  // "simple" averages scores. Both should merge sub-word tokens.
  // If both fail (some model/runtime combos don't support it), fall back to
  // manual BIO aggregation.
  let rawEntities: RawNerToken[];
  try {
    rawEntities = await pipeline(text, {
      aggregation_strategy: "first",
    });
  } catch {
    try {
      rawEntities = await pipeline(text, {
        aggregation_strategy: "simple",
      });
    } catch {
      // Last resort: raw BIO tokens, aggregated manually below
      rawEntities = await pipeline(text);
    }
  }



  onProgress?.({
    phase: "detecting",
    progress: 1,
    message: "PII detection complete.",
  });

  // Check if we got aggregated results (entity_group) or raw tokens (entity with B-/I- prefix)
  const isAggregated = rawEntities.length > 0 && rawEntities[0].entity_group != null;

  if (isAggregated) {
    return mapAggregatedEntities(rawEntities, text, minConfidence);
  } else {
    return aggregateAndMapTokens(rawEntities, text, minConfidence);
  }
}

/**
 * Map pre-aggregated entities (when Transformers.js aggregation works).
 */
function mapAggregatedEntities(
  rawEntities: RawNerToken[],
  text: string,
  minConfidence: number,
): PiiEntity[] {
  let idCounter = 0;
  const entities: PiiEntity[] = [];

  for (const entity of rawEntities) {
    if (entity.score < minConfidence) continue;

    const label = entity.entity_group ?? entity.entity ?? "UNKNOWN";
    const word = entity.word ?? "";

    let start = entity.start;
    let end = entity.end;

    // If offsets are missing, find by text matching
    if (start == null || end == null) {
      const found = findTextInString(text, word, entities.length > 0 ? (entities[entities.length - 1].end ?? 0) : 0);
      if (found) {
        start = found.start;
        end = found.end;
      } else {
        continue; // Can't locate this entity
      }
    }

    // Use canonical text from source string to avoid any tokenizer artifacts
    const canonicalText = text.slice(start, end);

    entities.push({
      id: `ner-${idCounter++}`,
      label: cleanLabel(label),
      text: canonicalText || word,
      start,
      end,
      score: entity.score,
      source: "ner",
    });
  }

  return entities;
}

/**
 * Manually aggregate BIO-tagged tokens into entities with character offsets.
 * This handles the case where Transformers.js returns raw token-level results.
 */
function aggregateAndMapTokens(
  tokens: RawNerToken[],
  text: string,
  minConfidence: number,
): PiiEntity[] {
  const entities: PiiEntity[] = [];
  let idCounter = 0;

  // Group consecutive tokens with the same entity type (BIO scheme)
  let currentGroup: RawNerToken[] = [];
  let currentType: string = "";

  for (const token of tokens) {
    const entity = token.entity ?? "";
    // Skip "O" (outside) tokens
    if (entity === "O" || entity === "") {
      if (currentGroup.length > 0) {
        const merged = mergeTokenGroup(currentGroup, currentType, text, idCounter++, minConfidence);
        if (merged) entities.push(merged);
        currentGroup = [];
        currentType = "";
      }
      continue;
    }

    // Parse BIO label: B-TYPE, I-TYPE, or just TYPE
    const bioPrefix = entity.substring(0, 2);
    const typeLabel = entity.includes("-") ? entity.substring(2) : entity;

    if (bioPrefix === "B-" || typeLabel !== currentType) {
      // Start of a new entity
      if (currentGroup.length > 0) {
        const merged = mergeTokenGroup(currentGroup, currentType, text, idCounter++, minConfidence);
        if (merged) entities.push(merged);
      }
      currentGroup = [token];
      currentType = typeLabel;
    } else {
      // Continuation of current entity
      currentGroup.push(token);
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    const merged = mergeTokenGroup(currentGroup, currentType, text, idCounter++, minConfidence);
    if (merged) entities.push(merged);
  }

  return entities;
}

/**
 * Merge a group of BIO tokens into a single PiiEntity.
 */
function mergeTokenGroup(
  tokens: RawNerToken[],
  typeLabel: string,
  text: string,
  id: number,
  minConfidence: number,
): PiiEntity | null {
  if (tokens.length === 0) return null;

  const avgScore = tokens.reduce((sum, t) => sum + t.score, 0) / tokens.length;
  if (avgScore < minConfidence) return null;

  // If any token has start/end offsets, use them as the span —
  // they're more reliable than reconstructing from stripped sub-word pieces.
  const firstWithStart = tokens.find((t) => t.start != null);
  const lastWithEnd = [...tokens].reverse().find((t) => t.end != null);

  let start: number;
  let end: number;
  let entityText: string;

  if (firstWithStart?.start != null && lastWithEnd?.end != null) {
    start = firstWithStart.start;
    end = lastWithEnd.end;
    // Use canonical text from the source string (avoids ▁ / ## artifacts)
    entityText = text.slice(start, end);
  } else {
    // No offsets — reconstruct text from token words and find in source
    const mergedText = tokens
      .map((t) => {
        let word = t.word ?? "";
        if (word.startsWith("##")) word = word.slice(2);
        word = word.replace(/^▁/, "");
        return word;
      })
      .join("");

    const found = findTextInString(text, mergedText, 0);
    if (!found) {
      // Try matching just the first token's word
      const firstWord = tokens[0].word?.replace(/^▁/, "").replace(/^##/, "") ?? "";
      const found2 = findTextInString(text, firstWord, 0);
      if (!found2) return null;
      start = found2.start;
      end = start + mergedText.length;
    } else {
      start = found.start;
      end = found.end;
    }
    entityText = text.slice(start, end);
  }

  return {
    id: `ner-${id}`,
    label: cleanLabel(typeLabel),
    text: entityText,
    start,
    end,
    score: avgScore,
    source: "ner",
  };
}

/**
 * Find a substring in text, starting from a given offset.
 * Case-insensitive to handle OCR variations.
 */
function findTextInString(
  text: string,
  needle: string,
  fromIndex: number,
): { start: number; end: number } | null {
  if (!needle || needle.length === 0) return null;

  // Try exact match first
  let idx = text.indexOf(needle, fromIndex);
  if (idx !== -1) return { start: idx, end: idx + needle.length };

  // Try case-insensitive
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  idx = lowerText.indexOf(lowerNeedle, fromIndex);
  if (idx !== -1) return { start: idx, end: idx + needle.length };

  // Try from the beginning if fromIndex > 0
  if (fromIndex > 0) {
    idx = lowerText.indexOf(lowerNeedle, 0);
    if (idx !== -1) return { start: idx, end: idx + needle.length };
  }

  return null;
}

/**
 * Clean BIO prefix from label if present.
 */
function cleanLabel(label: string): string {
  if (label.startsWith("B-") || label.startsWith("I-")) {
    return label.substring(2);
  }
  return label;
}

/**
 * Load (or reuse) the Transformers.js token-classification pipeline.
 */
async function loadPipeline(
  modelId: string,
  onProgress?: (event: ProgressEvent) => void,
) {
  if (pipelineInstance && pipelineModelId === modelId) {
    return pipelineInstance;
  }

  onProgress?.({
    phase: "loading",
    progress: 0,
    message: "Loading PII detection model...",
  });

  // Dynamic import — only load Transformers.js when needed
  const { pipeline, env } = await import("@xenova/transformers");

  // Attempt WebGPU, fall back gracefully
  env.allowLocalModels = false;

  // On mobile, skip the WebGPU probe (adds latency + often falls back anyway)
  // and go straight to WASM. On desktop, "auto" tries WebGPU first.
  const isMobile =
    typeof navigator !== "undefined" &&
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const pipelineOptions: Record<string, unknown> = {
    progress_callback: (p: any) => {
      if (p.status === "progress" && p.total) {
        onProgress?.({
          phase: "loading",
          progress: p.loaded / p.total,
          message: `Downloading model: ${Math.round((p.loaded / p.total) * 100)}%`,
        });
      }
    },
    // Use WASM on mobile (avoids slow WebGPU probe), auto on desktop
    device: isMobile ? "wasm" : "auto",
    // q4 (~45 MB) vs q8 (~85 MB) — halves the download with minimal accuracy loss
    dtype: "q4",
  };

  pipelineInstance = await pipeline(
    "token-classification",
    modelId,
    pipelineOptions as any,
  );

  pipelineModelId = modelId;

  onProgress?.({
    phase: "loading",
    progress: 1,
    message: "Model loaded.",
  });

  return pipelineInstance;
}

/**
 * Pre-load the model without running inference.
 * The host app can call this to warm up the cache.
 */
export async function preloadNerModel(
  modelId: string,
  onProgress?: (event: ProgressEvent) => void,
): Promise<void> {
  await loadPipeline(modelId, onProgress);
}

/**
 * Release the NER model from memory.
 *
 * Disposes the underlying ONNX session if the pipeline supports it,
 * then clears the singleton so the next call to detectPiiNer reloads.
 *
 * Use this in low-memory mode after OCR completes and before NER loads,
 * or after the component is disconnected.
 */
export async function releaseNerModel(): Promise<void> {
  if (pipelineInstance) {
    try {
      // Transformers.js pipelines may expose a dispose() method
      if (typeof pipelineInstance.dispose === "function") {
        await pipelineInstance.dispose();
      }
    } catch {
      // Non-fatal — just clear the reference
    }
    pipelineInstance = null;
    pipelineModelId = null;
  }
}
