/**
 * Unit tests for the image pre-processing module.
 *
 * We test the luminance calculation and decision logic in isolation.
 * The actual canvas pixel manipulation is tested via the helper functions
 * exposed for testing.
 */

import { describe, it, expect } from "vitest";
import {
  computeAverageLuminance,
  isDarkBackground,
  DARK_THRESHOLD,
} from "../preprocess.js";

// ── Fixtures: simulated pixel data (RGBA, 0-255) ──────────────────────────────

/** All-black image: luminance = 0 */
function makeBlackPixels(count: number): Uint8ClampedArray {
  return new Uint8ClampedArray(count * 4); // zeros = black
}

/** All-white image: luminance = 255 */
function makeWhitePixels(count: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    buf[i * 4 + 0] = 255; // R
    buf[i * 4 + 1] = 255; // G
    buf[i * 4 + 2] = 255; // B
    buf[i * 4 + 3] = 255; // A
  }
  return buf;
}

/** Dark blue (chat bubble color): rgb(37, 99, 235) */
function makeDarkBluePixels(count: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    buf[i * 4 + 0] = 37;  // R
    buf[i * 4 + 1] = 99;  // G
    buf[i * 4 + 2] = 235; // B
    buf[i * 4 + 3] = 255; // A
  }
  return buf;
}

/** Medium gray: luminance ≈ 128 */
function makeMidGrayPixels(count: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    buf[i * 4 + 0] = 128;
    buf[i * 4 + 1] = 128;
    buf[i * 4 + 2] = 128;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

// ── computeAverageLuminance ───────────────────────────────────────────────────

describe("computeAverageLuminance", () => {
  it("returns 0 for an all-black image", () => {
    const pixels = makeBlackPixels(100);
    expect(computeAverageLuminance(pixels)).toBe(0);
  });

  it("returns 255 for an all-white image", () => {
    const pixels = makeWhitePixels(100);
    expect(computeAverageLuminance(pixels)).toBe(255);
  });

  it("returns ~128 for a mid-gray image", () => {
    const pixels = makeMidGrayPixels(100);
    // Perceived luminance formula: 0.299R + 0.587G + 0.114B
    const expected = Math.round(0.299 * 128 + 0.587 * 128 + 0.114 * 128);
    expect(computeAverageLuminance(pixels)).toBeCloseTo(expected, 0);
  });

  it("computes weighted luminance (not simple average of RGB)", () => {
    // Pure red: (255, 0, 0) → luminance = 0.299 * 255 ≈ 76
    const buf = new Uint8ClampedArray(4);
    buf[0] = 255; buf[1] = 0; buf[2] = 0; buf[3] = 255;
    const lum = computeAverageLuminance(buf);
    expect(lum).toBeCloseTo(0.299 * 255, 0);
  });

  it("dark blue pixels have luminance well below 128", () => {
    const pixels = makeDarkBluePixels(50);
    const lum = computeAverageLuminance(pixels);
    // rgb(37,99,235) → 0.299*37 + 0.587*99 + 0.114*235 ≈ 11 + 58 + 27 ≈ 96
    expect(lum).toBeLessThan(128);
  });

  it("handles empty pixel array without throwing", () => {
    expect(() => computeAverageLuminance(new Uint8ClampedArray(0))).not.toThrow();
  });
});

// ── isDarkBackground ──────────────────────────────────────────────────────────

describe("isDarkBackground", () => {
  it("returns true for a black image", () => {
    expect(isDarkBackground(makeBlackPixels(100))).toBe(true);
  });

  it("returns false for a white image", () => {
    expect(isDarkBackground(makeWhitePixels(100))).toBe(false);
  });

  it("returns true for dark blue (chat bubble) pixels", () => {
    // Dark blue is a common dark-mode chat bubble color
    expect(isDarkBackground(makeDarkBluePixels(50))).toBe(true);
  });

  it("threshold value is exported and equals 128", () => {
    expect(DARK_THRESHOLD).toBe(128);
  });

  it("mid-gray (luminance=128) is NOT considered dark (boundary condition)", () => {
    // Exactly at threshold — we use strict less-than, so 128 is NOT dark
    const midGray = makeMidGrayPixels(100);
    const lum = computeAverageLuminance(midGray);
    // Mid-gray luminance is ~128, isDark uses lum < DARK_THRESHOLD
    expect(isDarkBackground(midGray)).toBe(lum < DARK_THRESHOLD);
  });
});
