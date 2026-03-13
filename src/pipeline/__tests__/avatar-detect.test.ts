import { describe, it, expect } from "vitest";
import { detectAvatars } from "../avatar-detect.js";
import type { Redaction } from "../../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNameRedaction(
  id: string,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  label = "PERSON",
): Redaction {
  return { id, bbox, source: "auto", enabled: true, label };
}

/**
 * Builds a mock getColumnBrightness function that simulates a real avatar
 * layout: white gap immediately left of name, then a dark avatar region.
 *
 * avatarX0..avatarX1 = dark region (brightness < 200)
 * gapX0..gapX1      = white gap between avatar and name (brightness > 240)
 */
function mockAvatarLayout(
  gapX0: number,
  gapX1: number,
  avatarX0: number,
  avatarX1: number,
): (x: number, y0: number, y1: number) => number {
  return (x) => {
    if (x >= gapX0 && x < gapX1) return 245; // bright gap
    if (x >= avatarX0 && x < avatarX1) return 170; // dark avatar
    return 245; // everything else is white background
  };
}

/** Uniform grey (message bubble text) — no gap, no dark region. */
function mockGreyBackground(): (x: number) => number {
  return () => 220;
}

// ── detectAvatars ─────────────────────────────────────────────────────────────

describe("detectAvatars", () => {
  it("detects an avatar to the left of a PERSON name redaction", () => {
    // Name bbox at x0=1677, y=103-125 (lineH=22)
    // Gap: x=1652-1677 (25px), Avatar: x=1601-1652 (51px, avg brightness 175)
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 1677, y0: 103, x1: 1975, y1: 125 }),
    ];
    const getColBrightness = mockAvatarLayout(1652, 1677, 1601, 1652);

    const avatars = detectAvatars(nameRedactions, 2070, 964, getColBrightness);

    expect(avatars).toHaveLength(1);
    expect(avatars[0].label).toBe("AVATAR");
    expect(avatars[0].source).toBe("auto");
    expect(avatars[0].enabled).toBe(true);
    // Avatar bbox should be to the left of the name
    expect(avatars[0].bbox.x1).toBeLessThanOrEqual(1677);
  });

  it("detects avatars near multiple name redactions on different lines", () => {
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 1677, y0: 103, x1: 1975, y1: 125 }),
      makeNameRedaction("r2", { x0: 1673, y0: 365, x1: 1927, y1: 387 }),
    ];
    // Both have gap+avatar layout at similar x positions
    const getColBrightness = (x: number) => {
      if ((x >= 1652 && x < 1677) || (x >= 1648 && x < 1673)) return 245; // gap
      if (x >= 1601 && x < 1652) return 170; // avatar
      return 245;
    };

    const avatars = detectAvatars(nameRedactions, 2070, 964, getColBrightness);
    expect(avatars).toHaveLength(2);
  });

  it("does not detect an avatar when region left of name is uniform grey (no gap+dark pattern)", () => {
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 1682, y0: 579, x1: 1900, y1: 601 }),
    ];
    // Simulate: continuous grey background, no gap, no dark region (Louis's FP)
    const getColBrightness = mockGreyBackground();

    const avatars = detectAvatars(nameRedactions, 2070, 964, getColBrightness);
    expect(avatars).toHaveLength(0);
  });

  it("does not detect an avatar when name is at the very left edge of the image", () => {
    // Name at x0=10 — no horizontal space for an avatar to the left
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 10, y0: 43, x1: 200, y1: 65 }),
    ];
    const getColBrightness = () => 245; // all white — no avatar

    const avatars = detectAvatars(nameRedactions, 2070, 964, getColBrightness);
    expect(avatars).toHaveLength(0);
  });

  it("deduplicates avatars when multiple name redactions on same line point to same avatar", () => {
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 1677, y0: 103, x1: 1754, y1: 125 }, "GIVENNAME"),
      makeNameRedaction("r2", { x0: 1764, y0: 103, x1: 1975, y1: 125 }, "SURNAME"),
    ];
    const getColBrightness = mockAvatarLayout(1652, 1677, 1601, 1652);

    const avatars = detectAvatars(nameRedactions, 2070, 964, getColBrightness);
    expect(avatars).toHaveLength(1);
  });

  it("only searches near person-label redactions, ignores DATE etc.", () => {
    const dateRedaction: Redaction = {
      id: "r1",
      bbox: { x0: 300, y0: 100, x1: 500, y1: 120 },
      source: "auto",
      enabled: true,
      label: "DATE",
    };
    // Even with a perfect avatar pattern, DATE should not trigger
    const getColBrightness = mockAvatarLayout(275, 300, 224, 275);

    const avatars = detectAvatars([dateRedaction], 2070, 964, getColBrightness);
    expect(avatars).toHaveLength(0);
  });

  it("handles empty redactions list gracefully", () => {
    const avatars = detectAvatars([], 2070, 964, () => 245);
    expect(avatars).toHaveLength(0);
  });

  it("does not query columns beyond the left image edge", () => {
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 10, y0: 100, x1: 200, y1: 120 }),
    ];
    const queriedXValues: number[] = [];
    const getColBrightness = (x: number) => { queriedXValues.push(x); return 245; };

    detectAvatars(nameRedactions, 2070, 964, getColBrightness);
    if (queriedXValues.length > 0) {
      expect(Math.min(...queriedXValues)).toBeGreaterThanOrEqual(0);
    }
  });
});
