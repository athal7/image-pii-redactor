import { describe, it, expect } from "vitest";
import { detectPiiRegex } from "../pii-regex.js";

// Representative AI-chat-style text with various PII types
const CHAT_TEXT = `
Hi, my name is Sarah Johnson.
I live at 742 Evergreen Terrace, Springfield, IL 62704.
My email is sarah.j@gmail.com and my backup is s.johnson@work.org.
Please call me at 555-867-5309 or +1 (800) 555-0199.
My SSN is 123-45-6789 and my DOB is 03/15/1985.
Visit https://example.com/account?token=abc123 for details.
My IP is 192.168.1.42.
Find me @sarah_j on social media.
`.trim();

describe("detectPiiRegex", () => {
  it("detects email addresses", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    const emails = entities.filter((e) => e.label === "EMAIL");
    const texts = emails.map((e) => e.text);
    expect(texts).toContain("sarah.j@gmail.com");
    expect(texts).toContain("s.johnson@work.org");
  });

  it("detects US phone numbers", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    const phones = entities.filter((e) => e.label === "TELEPHONENUM");
    const texts = phones.map((e) => e.text);
    expect(texts.some((t) => t.includes("555-867-5309"))).toBe(true);
    expect(texts.some((t) => t.includes("800") && t.includes("555"))).toBe(true);
  });

  it("detects Social Security Numbers", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    const ssns = entities.filter((e) => e.label === "SSN");
    expect(ssns.map((e) => e.text)).toContain("123-45-6789");
  });

  it("detects dates", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    const dates = entities.filter((e) => e.label === "DATE");
    expect(dates.map((e) => e.text)).toContain("03/15/1985");
  });

  it("detects URLs", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    const urls = entities.filter((e) => e.label === "URL");
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0].text).toContain("https://example.com");
  });

  it("detects IP addresses", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    const ips = entities.filter((e) => e.label === "IP_ADDRESS");
    expect(ips.map((e) => e.text)).toContain("192.168.1.42");
  });

  it("detects @username handles", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    const usernames = entities.filter((e) => e.label === "USERNAME");
    expect(usernames.map((e) => e.text)).toContain("@sarah_j");
  });

  it("returns entity offsets that point to the correct substring", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    for (const entity of entities) {
      const slice = CHAT_TEXT.slice(entity.start, entity.end);
      expect(slice).toBe(entity.text);
    }
  });

  it("marks all regex entities with score 1.0 and source 'regex'", () => {
    const entities = detectPiiRegex(CHAT_TEXT);
    expect(entities.length).toBeGreaterThan(0);
    for (const entity of entities) {
      expect(entity.score).toBe(1.0);
      expect(entity.source).toBe("regex");
    }
  });

  it("deduplicates overlapping spans, keeping the longer match", () => {
    // Phone number with extension — should be one entity, not two
    const text = "Call 555-867-5309 ext. 42 today.";
    const entities = detectPiiRegex(text);
    const phones = entities.filter((e) => e.label === "TELEPHONENUM");
    // Should not have two separate entities overlapping at "555-867-5309"
    const starts = phones.map((e) => e.start);
    const uniqueStarts = new Set(starts);
    expect(uniqueStarts.size).toBe(starts.length);
  });

  it("handles empty string without throwing", () => {
    expect(() => detectPiiRegex("")).not.toThrow();
    expect(detectPiiRegex("")).toEqual([]);
  });

  it("handles text with no PII without throwing", () => {
    const result = detectPiiRegex("The weather today is sunny and warm.");
    // No PII expected (some false positives are acceptable, but no crash)
    expect(Array.isArray(result)).toBe(true);
  });

  it("detects written-out month-name dates (e.g. October 24, 2025)", () => {
    const texts = [
      "October 24, 2025.",
      "January 2025.",
      "December 2023.",
      "March 15, 1985",
      "Published on February 28, 2024.",
    ];
    for (const text of texts) {
      const entities = detectPiiRegex(text);
      const dates = entities.filter(e => e.label === "DATE");
      expect(dates.length).toBeGreaterThan(0);
    }
  });

  it("finds PII in multiline OCR-style text", () => {
    // Simulate what Tesseract.js outputs: words may be split weirdly
    const ocrText = "Your email sarah.j@gmail.com\nwas verified on 03/15/1985.\nMy phone is 555-867-5309.";
    const entities = detectPiiRegex(ocrText);
    const labels = entities.map((e) => e.label);
    expect(labels).toContain("EMAIL");
    expect(labels).toContain("DATE");
    expect(labels).toContain("TELEPHONENUM");
  });
});
