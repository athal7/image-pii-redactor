/**
 * Bounding box in original image pixel coordinates.
 */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A word extracted by OCR, with its position in both the image and the
 * reconstructed full-text string.
 */
export interface OcrWord {
  text: string;
  bbox: BBox;
  confidence: number;
  /** Inclusive start index in the reconstructed full text. */
  charStart: number;
  /** Exclusive end index in the reconstructed full text. */
  charEnd: number;
  /** Index of the line this word belongs to. */
  lineIndex: number;
}

/**
 * Full result from the OCR stage.
 */
export interface OcrResult {
  /** Reconstructed full text (words joined by spaces, lines by newlines). */
  fullText: string;
  words: OcrWord[];
  /** Original image dimensions in pixels. */
  imageWidth: number;
  imageHeight: number;
}

/**
 * A PII entity detected by the NER model or regex patterns.
 */
export interface PiiEntity {
  id: string;
  /** NER label: GIVENNAME, SURNAME, EMAIL, TELEPHONENUM, CITY, DATE, etc. */
  label: string;
  /** The matched text. */
  text: string;
  /** Character offset (inclusive) in the OCR full text. */
  start: number;
  /** Character offset (exclusive) in the OCR full text. */
  end: number;
  /** Confidence score 0-1. For regex matches this is 1.0. */
  score: number;
  /** Detection source. */
  source: "ner" | "regex";
}

/**
 * A redaction box to be drawn on the image.
 */
export interface Redaction {
  id: string;
  bbox: BBox;
  /** How this redaction was created. */
  source: "auto" | "manual";
  /** If auto-detected, the entity that produced it. */
  entityId?: string;
  /** User can toggle individual redactions off. */
  enabled: boolean;
  /** Display label for the entity type. */
  label?: string;
}

/**
 * The phases the component moves through.
 */
export type Phase =
  | "idle"
  | "loading"
  | "ocr"
  | "detecting"
  | "reviewing"
  | "exporting";

/**
 * Progress update emitted during model loading and processing.
 */
export interface ProgressEvent {
  phase: Phase;
  /** 0-1 progress within the current phase. */
  progress: number;
  message: string;
}

/**
 * Final output when user confirms redactions.
 */
export interface RedactionResult {
  /** PNG blob with redactions burned in. */
  blob: Blob;
  /** Detected entities (for metadata — contains no PII, only labels + bbox). */
  entities: Array<{
    label: string;
    bbox: BBox;
    source: "auto" | "manual";
  }>;
  /** Image dimensions. */
  width: number;
  height: number;
}

/**
 * Configuration for the redactor component.
 */
export interface RedactorConfig {
  /** Tesseract OCR language. Default: 'eng'. */
  lang?: string;
  /** HuggingFace model ID for NER. */
  nerModel?: string;
  /** Maximum file size in bytes. Default: 20MB. */
  maxFileSize?: number;
  /** Accepted MIME types. */
  acceptedTypes?: string[];
  /** Minimum NER confidence to auto-redact. Default: 0.7. */
  minConfidence?: number;
  /** Whether to run regex PII patterns in addition to NER. Default: true. */
  useRegex?: boolean;
  /**
   * Memory mode for constrained devices.
   *
   * - `"auto"`: Detect from `navigator.deviceMemory`; use "low" when < 4 GB.
   * - `"low"`:  Release the Tesseract worker before loading the NER model,
   *             reducing peak RAM. Adds a small sequential delay.
   * - `"normal"`: Run Tesseract and NER without explicit memory management.
   *
   * Default: "auto"
   */
  memoryMode?: "auto" | "low" | "normal";
}

export const DEFAULT_CONFIG: Required<RedactorConfig> = {
  lang: "eng",
  nerModel: "onnx-community/multilang-pii-ner-ONNX",
  maxFileSize: 20 * 1024 * 1024,
  acceptedTypes: ["image/png", "image/jpeg", "image/webp"],
  minConfidence: 0.7,
  useRegex: true,
  memoryMode: "auto",
};
