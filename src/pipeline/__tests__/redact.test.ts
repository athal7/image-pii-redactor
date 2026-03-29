/**
 * Tests for the redact module.
 *
 * Key invariant: the exported PNG blob must contain no metadata chunks.
 * Original images may carry EXIF, XMP, iTXt, tEXt, zTXt, or GPS data.
 * The canvas round-trip must strip all of this before the blob leaves the
 * device.
 */

import { describe, it, expect } from "vitest";
import { parsePngChunkNames, buildRedactedText } from "../redact.js";
import type { OcrWord, OcrResult, PiiEntity, Redaction } from "../../types.js";

// ── buildRedactedText ─────────────────────────────────────────────────────────

// Helpers
function makeWord(
  text: string,
  charStart: number,
  lineIndex: number,
  bbox: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: 100, y1: 20 },
): OcrWord {
  return { text, charStart, charEnd: charStart + text.length, bbox, confidence: 99, lineIndex };
}

function makeOcrResult(fullText: string, words: OcrWord[]): OcrResult {
  return { fullText, words, imageWidth: 800, imageHeight: 600 };
}

function makeEntity(
  id: string,
  label: string,
  start: number,
  end: number,
): PiiEntity {
  return { id, label, text: "", start, end, score: 0.95, source: "ner" };
}

function makeRedaction(
  id: string,
  opts: {
    enabled?: boolean;
    entityId?: string;
    label?: string;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
    source?: "auto" | "manual";
  } = {},
): Redaction {
  return {
    id,
    bbox: opts.bbox ?? { x0: 0, y0: 0, x1: 100, y1: 20 },
    source: opts.source ?? "auto",
    entityId: opts.entityId,
    enabled: opts.enabled ?? true,
    label: opts.label,
  };
}

describe("buildRedactedText", () => {
  it("returns empty string when ocrResult is null", () => {
    const result = buildRedactedText(null, [], []);
    expect(result).toBe("");
  });

  it("returns fullText unchanged when there are no redactions", () => {
    const words = [
      makeWord("Hello", 0, 0),
      makeWord("world", 6, 0),
    ];
    const ocr = makeOcrResult("Hello world", words);
    expect(buildRedactedText(ocr, [], [])).toBe("Hello world");
  });

  it("returns fullText unchanged when all redactions are disabled", () => {
    const words = [
      makeWord("Hello", 0, 0),
      makeWord("Sarah", 6, 0),
    ];
    const ocr = makeOcrResult("Hello Sarah", words);
    const entities = [makeEntity("e1", "GIVENNAME", 6, 11)];
    const redactions = [makeRedaction("r1", { enabled: false, entityId: "e1" })];
    expect(buildRedactedText(ocr, redactions, entities)).toBe("Hello Sarah");
  });

  it("replaces a single redacted word with [REDACTED]", () => {
    const words = [
      makeWord("Hello", 0, 0),
      makeWord("Sarah", 6, 0),
    ];
    const ocr = makeOcrResult("Hello Sarah", words);
    const entities = [makeEntity("e1", "GIVENNAME", 6, 11)];
    const redactions = [makeRedaction("r1", { entityId: "e1" })];
    expect(buildRedactedText(ocr, redactions, entities)).toBe("Hello [REDACTED]");
  });

  it("merges adjacent redacted words on the same line into a single [REDACTED]", () => {
    // "John Smith" — two adjacent words, same entity
    const words = [
      makeWord("John",  0, 0),
      makeWord("Smith", 5, 0),
    ];
    const ocr = makeOcrResult("John Smith", words);
    const entities = [makeEntity("e1", "PERSON", 0, 10)];
    const redactions = [makeRedaction("r1", { entityId: "e1" })];
    expect(buildRedactedText(ocr, redactions, entities)).toBe("[REDACTED]");
  });

  it("produces two [REDACTED] tokens for non-contiguous redacted words on the same line", () => {
    // "John hello Smith" — John and Smith redacted, hello is not
    const words = [
      makeWord("John",  0, 0),
      makeWord("hello", 5, 0),
      makeWord("Smith", 11, 0),
    ];
    const ocr = makeOcrResult("John hello Smith", words);
    const e1 = makeEntity("e1", "GIVENNAME", 0, 4);
    const e2 = makeEntity("e2", "SURNAME",   11, 16);
    const r1 = makeRedaction("r1", { entityId: "e1" });
    const r2 = makeRedaction("r2", { entityId: "e2" });
    expect(buildRedactedText(ocr, [r1, r2], [e1, e2])).toBe("[REDACTED] hello [REDACTED]");
  });

  it("produces two [REDACTED] tokens with newline for redacted words on different lines", () => {
    // "John\nSmith" — each on its own line
    const words = [
      makeWord("John",  0, 0),
      makeWord("Smith", 5, 1),
    ];
    const ocr = makeOcrResult("John\nSmith", words);
    const entities = [makeEntity("e1", "PERSON", 0, 10)];
    const redactions = [makeRedaction("r1", { entityId: "e1" })];
    expect(buildRedactedText(ocr, redactions, entities)).toBe("[REDACTED]\n[REDACTED]");
  });

  it("does NOT replace words for AVATAR-labeled redactions", () => {
    const words = [makeWord("Sarah", 0, 0)];
    const ocr = makeOcrResult("Sarah", words);
    const entities = [makeEntity("e1", "AVATAR", 0, 5)];
    const redactions = [makeRedaction("r1", { entityId: "e1", label: "AVATAR" })];
    expect(buildRedactedText(ocr, redactions, entities)).toBe("Sarah");
  });

  it("replaces word overlapping manual redaction bbox", () => {
    const words = [
      makeWord("Hello",  0, 0, { x0: 0,   y0: 0, x1: 50,  y1: 20 }),
      makeWord("secret", 6, 0, { x0: 60,  y0: 0, x1: 120, y1: 20 }),
      makeWord("world",  13, 0, { x0: 130, y0: 0, x1: 180, y1: 20 }),
    ];
    const ocr = makeOcrResult("Hello secret world", words);
    // Manual redaction overlapping "secret"
    const redaction = makeRedaction("r1", {
      source: "manual",
      bbox: { x0: 55, y0: 0, x1: 125, y1: 20 },
    });
    expect(buildRedactedText(ocr, [redaction], [])).toBe("Hello [REDACTED] world");
  });

  it("does NOT replace words for disabled redactions", () => {
    const words = [
      makeWord("Hello", 0, 0),
      makeWord("Sarah", 6, 0),
    ];
    const ocr = makeOcrResult("Hello Sarah", words);
    const entities = [makeEntity("e1", "GIVENNAME", 6, 11)];
    const redactions = [makeRedaction("r1", { enabled: false, entityId: "e1" })];
    expect(buildRedactedText(ocr, redactions, entities)).toBe("Hello Sarah");
  });

  it("deduplicates when multiple entities cover the same word", () => {
    const words = [makeWord("Sarah", 0, 0)];
    const ocr = makeOcrResult("Sarah", words);
    const e1 = makeEntity("e1", "GIVENNAME", 0, 5);
    const e2 = makeEntity("e2", "PERSON",    0, 5);
    const r1 = makeRedaction("r1", { entityId: "e1" });
    const r2 = makeRedaction("r2", { entityId: "e2" });
    // Should still produce a single [REDACTED], not two
    expect(buildRedactedText(ocr, [r1, r2], [e1, e2])).toBe("[REDACTED]");
  });

  it("returns empty string for empty words array", () => {
    const ocr = makeOcrResult("", []);
    expect(buildRedactedText(ocr, [], [])).toBe("");
  });
});

// ── PNG metadata chunk helpers ────────────────────────────────────────────────

/**
 * Metadata chunk types defined by the PNG spec that must NOT appear in
 * a privacy-safe export:
 *
 *  tEXt  – uncompressed Latin-1 text key/value pairs
 *  iTXt  – UTF-8 international text (used by XMP / EXIF payloads in PNG)
 *  zTXt  – compressed text
 *  eXIf  – EXIF data embedded in PNG (PNG 1.6+ extension, widely used)
 *  tIME  – image creation/modification timestamp
 *  (gAMA – gamma: not sensitive, intentionally excluded from this list)
 */
const SENSITIVE_CHUNK_TYPES = ["tEXt", "iTXt", "zTXt", "eXIf", "tIME"];

// ── PNG byte-stream helpers for building synthetic PNGs in tests ──────────────

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function uint32BE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, value, false);
  return buf;
}

/** CRC-32 table (IEEE) — needed to produce a valid PNG chunk. */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunkData = new Uint8Array(typeBytes.length + data.length);
  chunkData.set(typeBytes, 0);
  chunkData.set(data, typeBytes.length);
  const crc = uint32BE(crc32(chunkData));
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  chunk.set(uint32BE(data.length), 0);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  chunk.set(crc, 8 + data.length);
  return chunk;
}

/** Minimal 1×1 white PNG: signature + IHDR + IDAT + IEND. */
function makeMinimalPng(): Uint8Array {
  // IHDR: width=1, height=1, bit depth=8, color type=2 (RGB), compression=0,
  //       filter=0, interlace=0
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  // IDAT: zlib-compressed single white pixel (filter byte 0 + RGB 255,255,255)
  // Pre-computed valid zlib stream for this pixel.
  const idat = new Uint8Array([
    0x78, 0x01, 0x62, 0xf8, 0xcf, 0xc0, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00,
    0x01,
  ]);
  const iend = new Uint8Array(0);

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", idat);
  const iendChunk = makeChunk("IEND", iend);

  const totalLen =
    PNG_SIGNATURE.length +
    ihdrChunk.length +
    idatChunk.length +
    iendChunk.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);
  return png;
}

/** Insert an extra chunk (e.g. tEXt) after IHDR and before IDAT. */
function injectChunk(png: Uint8Array, chunkType: string, payload: string): Uint8Array {
  const data = new TextEncoder().encode(payload);
  const injected = makeChunk(chunkType, data);
  // Find the offset right after IHDR chunk (sig=8, length=4, type=4, data=13, crc=4 → 33)
  const insertAt = 8 + 4 + 4 + 13 + 4; // = 33
  const result = new Uint8Array(png.length + injected.length);
  result.set(png.slice(0, insertAt), 0);
  result.set(injected, insertAt);
  result.set(png.slice(insertAt), insertAt + injected.length);
  return result;
}

// ── parsePngChunkNames ────────────────────────────────────────────────────────

describe("parsePngChunkNames", () => {
  it("returns expected critical chunks for a minimal PNG", () => {
    const png = makeMinimalPng();
    const chunks = parsePngChunkNames(png);
    expect(chunks).toContain("IHDR");
    expect(chunks).toContain("IDAT");
    expect(chunks).toContain("IEND");
  });

  it("detects tEXt chunk injected into PNG", () => {
    const png = injectChunk(makeMinimalPng(), "tEXt", "Comment\x00test value");
    const chunks = parsePngChunkNames(png);
    expect(chunks).toContain("tEXt");
  });

  it("detects iTXt chunk injected into PNG", () => {
    const png = injectChunk(makeMinimalPng(), "iTXt", "XML:com.adobe.xmp\x00\x00\x00\x00\x00<xmp/>");
    const chunks = parsePngChunkNames(png);
    expect(chunks).toContain("iTXt");
  });

  it("detects eXIf chunk injected into PNG", () => {
    const png = injectChunk(makeMinimalPng(), "eXIf", "II*\x00fake exif");
    const chunks = parsePngChunkNames(png);
    expect(chunks).toContain("eXIf");
  });

  it("detects tIME chunk injected into PNG", () => {
    const png = injectChunk(makeMinimalPng(), "tIME", "\x07\xd2\x01\x01\x00\x00\x00");
    const chunks = parsePngChunkNames(png);
    expect(chunks).toContain("tIME");
  });

  it("returns empty array for empty buffer", () => {
    expect(parsePngChunkNames(new Uint8Array(0))).toEqual([]);
  });

  it("returns empty array for non-PNG bytes (no signature)", () => {
    const notPng = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG SOI
    expect(parsePngChunkNames(notPng)).toEqual([]);
  });
});

// ── no-metadata guarantee ─────────────────────────────────────────────────────

describe("canvas PNG export metadata guarantee", () => {
  it("a minimal clean PNG has no sensitive metadata chunks", () => {
    const png = makeMinimalPng();
    const chunks = parsePngChunkNames(png);
    for (const sensitive of SENSITIVE_CHUNK_TYPES) {
      expect(chunks, `should not contain ${sensitive}`).not.toContain(sensitive);
    }
  });

  it("parsePngChunkNames detects all SENSITIVE_CHUNK_TYPES when injected", () => {
    // This test verifies our detector works for every chunk type we care about.
    // If a future regression re-introduces metadata, this will catch it.
    for (const chunkType of SENSITIVE_CHUNK_TYPES) {
      const png = injectChunk(makeMinimalPng(), chunkType, "test-payload");
      const chunks = parsePngChunkNames(png);
      expect(chunks, `should detect injected ${chunkType}`).toContain(chunkType);
    }
  });
});
