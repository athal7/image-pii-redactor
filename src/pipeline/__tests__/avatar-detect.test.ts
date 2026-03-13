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
 * A mock pixel variance fn that returns high variance for a specific region
 * (simulating an avatar) and zero elsewhere (white background).
 */
function mockHighVarianceAt(
  avatarX0: number,
  avatarY0: number,
  avatarX1: number,
  avatarY1: number,
): (bbox: { x0: number; y0: number; x1: number; y1: number }) => number {
  return (bbox) => {
    // Check if the queried bbox overlaps the avatar region
    const overlaps =
      bbox.x0 < avatarX1 &&
      bbox.x1 > avatarX0 &&
      bbox.y0 < avatarY1 &&
      bbox.y1 > avatarY0;
    return overlaps ? 12000 : 0;
  };
}

// ── detectAvatars ─────────────────────────────────────────────────────────────

describe("detectAvatars", () => {
  it("detects an avatar to the left of a PERSON name redaction", () => {
    // Name bbox at x0=1677, y0=103, simulating "Claire Jenifer Pershan"
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 1677, y0: 103, x1: 1975, y1: 125 }),
    ];
    // Mock: high variance region at x=1590-1679, y=95-149 (the avatar)
    const getVariance = mockHighVarianceAt(1590, 95, 1679, 149);

    const avatars = detectAvatars(nameRedactions, 2070, 964, getVariance);

    expect(avatars).toHaveLength(1);
    expect(avatars[0].label).toBe("AVATAR");
    expect(avatars[0].source).toBe("auto");
    expect(avatars[0].enabled).toBe(true);
    // Avatar should be to the left of the name
    expect(avatars[0].bbox.x1).toBeLessThanOrEqual(1677);
  });

  it("detects avatars near multiple name redactions on different lines", () => {
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 1677, y0: 103, x1: 1975, y1: 125 }),
      makeNameRedaction("r2", { x0: 1673, y0: 365, x1: 1927, y1: 387 }),
    ];
    const getVariance = (bbox: { x0: number; y0: number; x1: number; y1: number }) => {
      // Avatar 1: near y=103
      if (bbox.x0 < 1679 && bbox.x1 > 1590 && bbox.y0 < 149 && bbox.y1 > 95) return 12000;
      // Avatar 2: near y=365
      if (bbox.x0 < 1679 && bbox.x1 > 1550 && bbox.y0 < 409 && bbox.y1 > 330) return 10000;
      return 0;
    };

    const avatars = detectAvatars(nameRedactions, 2070, 964, getVariance);
    expect(avatars).toHaveLength(2);
  });

  it("does not emit an avatar when the region to the left is plain background (low variance)", () => {
    // Name at left edge — no room for an avatar, all variance is 0
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 65, y0: 43, x1: 264, y1: 65 }),
    ];
    const getVariance = () => 0; // pure white background everywhere

    const avatars = detectAvatars(nameRedactions, 2070, 964, getVariance);
    expect(avatars).toHaveLength(0);
  });

  it("deduplicates avatars when multiple name redactions point to the same region", () => {
    // Two name redactions on the same visual line (e.g. GIVENNAME + SURNAME)
    // both pointing left to the same avatar
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 1677, y0: 103, x1: 1754, y1: 125 }, "GIVENNAME"),
      makeNameRedaction("r2", { x0: 1764, y0: 103, x1: 1975, y1: 125 }, "SURNAME"),
    ];
    const getVariance = mockHighVarianceAt(1590, 95, 1679, 149);

    const avatars = detectAvatars(nameRedactions, 2070, 964, getVariance);
    // Should produce only 1 avatar, not 2
    expect(avatars).toHaveLength(1);
  });

  it("only searches left of name redactions with person labels", () => {
    // A DATE redaction should not trigger avatar search
    const dateRedaction: Redaction = {
      id: "r1",
      bbox: { x0: 300, y0: 100, x1: 500, y1: 120 },
      source: "auto",
      enabled: true,
      label: "DATE",
    };
    const getVariance = () => 15000; // high variance everywhere

    const avatars = detectAvatars([dateRedaction], 2070, 964, getVariance);
    expect(avatars).toHaveLength(0);
  });

  it("handles empty redactions list gracefully", () => {
    const avatars = detectAvatars([], 2070, 964, () => 0);
    expect(avatars).toHaveLength(0);
  });

  it("does not search beyond the left edge of the image", () => {
    // Name at x0=10 — search would go to x=-120 without clamping
    const nameRedactions = [
      makeNameRedaction("r1", { x0: 10, y0: 100, x1: 200, y1: 120 }),
    ];
    let minXQueried = Infinity;
    const getVariance = (bbox: { x0: number; y0: number; x1: number; y1: number }) => {
      if (bbox.x0 < minXQueried) minXQueried = bbox.x0;
      return 0;
    };

    detectAvatars(nameRedactions, 2070, 964, getVariance);
    expect(minXQueried).toBeGreaterThanOrEqual(0);
  });
});
