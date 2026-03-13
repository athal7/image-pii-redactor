/**
 * End-to-end tests for <pii-redactor>.
 *
 * These tests run in a real browser via Playwright and exercise the full
 * pipeline: image upload → OCR → NER → SVG overlay → export.
 *
 * IMPORTANT: The first run downloads the NER model (~80MB). Subsequent runs
 * use the browser cache. Set the SKIP_MODEL_DOWNLOAD env var to skip tests
 * that require model inference (for fast CI pre-flight checks).
 */

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_URL = process.env.DEMO_URL ?? "/demo/";
const TEST_IMAGE = path.resolve(__dirname, "../../demo/test-screenshot.png");

// Helper: get a property from inside the Shadow DOM
async function shadowProp(page: Page, selector: string): Promise<unknown> {
  return page.evaluate((sel) => {
    const el = document.querySelector("pii-redactor") as any;
    return el?.[sel];
  }, selector);
}

// Helper: wait for the component to reach a given phase
async function waitForPhase(page: Page, phase: string, timeout = 240_000) {
  await page.waitForFunction(
    (p) => {
      const el = document.querySelector("pii-redactor") as any;
      return el?.phase === p;
    },
    phase,
    { timeout },
  );
}

// Helper: get the shadow root element text content
async function shadowText(page: Page, cssSelector: string): Promise<string> {
  return page.evaluate((sel) => {
    const host = document.querySelector("pii-redactor");
    if (!host?.shadowRoot) return "";
    return host.shadowRoot.querySelector(sel)?.textContent?.trim() ?? "";
  }, cssSelector);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL);
  // Wait for the Web Component to register and render
  await page.waitForSelector("pii-redactor");
  await page.waitForFunction(() => {
    const el = document.querySelector("pii-redactor") as any;
    return el?.phase === "idle";
  });
});

// ── Trust layer ───────────────────────────────────────────────────────────────

test("trust banner is visible and shows privacy message", async ({
  page,
}) => {
  const bannerText = await shadowText(page, ".trust-banner");
  expect(bannerText).toContain("Your data never leaves your device");
});

// ── File upload ───────────────────────────────────────────────────────────────

test("drop zone is visible in idle state", async ({ page }) => {
  const dropzoneVisible = await page.evaluate(() => {
    const host = document.querySelector("pii-redactor");
    return !!host?.shadowRoot?.querySelector(".dropzone");
  });
  expect(dropzoneVisible).toBe(true);
});

test("uploading an invalid file type shows an error", async ({ page }) => {
  // Upload a text file instead of an image
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.evaluate(() => {
      const host = document.querySelector("pii-redactor");
      host?.shadowRoot?.querySelector<HTMLElement>(".dropzone")?.click();
    }),
  ]);

  // Create a temp text file and upload it
  const tmpFile = path.resolve(__dirname, "../../demo/test.txt");
  await import("fs").then((fs) =>
    fs.writeFileSync(tmpFile, "not an image"),
  );

  await fileChooser.setFiles(tmpFile);

  // Should show error message
  await page.waitForFunction(() => {
    const host = document.querySelector("pii-redactor") as any;
    return host?.errorMessage?.includes("Unsupported") || host?.errorMessage?.length > 0;
  }, { timeout: 5_000 });

  const error = await shadowText(page, ".error");
  expect(error).toBeTruthy();
});

// ── Full pipeline (requires model download) ───────────────────────────────────

test.describe("pipeline tests (requires model download)", () => {
  // These tests may take a long time on first run due to model download
  test.setTimeout(300_000);

  test("uploading a screenshot starts the loading phase", async ({ page }) => {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.evaluate(() => {
        document.querySelector("pii-redactor")?.shadowRoot
          ?.querySelector<HTMLElement>(".dropzone")?.click();
      }),
    ]);
    await fileChooser.setFiles(TEST_IMAGE);

    // Should leave idle immediately
    await page.waitForFunction(() => {
      const el = document.querySelector("pii-redactor") as any;
      return el?.phase !== "idle";
    }, { timeout: 10_000 });

    const phase = await shadowProp(page, "phase");
    expect(["loading", "ocr", "detecting", "reviewing"]).toContain(phase);
  });

  test("pipeline reaches reviewing phase and renders SVG redaction boxes", async ({
    page,
  }) => {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.evaluate(() => {
        document.querySelector("pii-redactor")?.shadowRoot
          ?.querySelector<HTMLElement>(".dropzone")?.click();
      }),
    ]);
    await fileChooser.setFiles(TEST_IMAGE);

    // Wait for reviewing phase (model download + OCR + NER)
    await waitForPhase(page, "reviewing");

    // Verify SVG overlay exists with redaction rects
    const rectCount = await page.evaluate(() => {
      const host = document.querySelector("pii-redactor");
      const svgs = host?.shadowRoot?.querySelectorAll("svg");
      if (!svgs) return 0;
      // The overlay SVG (not the icon SVG)
      for (const svg of svgs) {
        const rects = svg.querySelectorAll("rect.redaction-box");
        if (rects.length > 0) return rects.length;
      }
      return 0;
    });

    // Should find at least some redactions in our test image
    // (email, date, phone number are present)
    expect(rectCount).toBeGreaterThan(0);
  });

  test("entity list shows detected items", async ({ page }) => {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.evaluate(() => {
        document.querySelector("pii-redactor")?.shadowRoot
          ?.querySelector<HTMLElement>(".dropzone")?.click();
      }),
    ]);
    await fileChooser.setFiles(TEST_IMAGE);
    await waitForPhase(page, "reviewing");

    // Use innerText to get the full rendered text across child nodes, then
    // normalise whitespace so inline elements don't split the string.
    const headerText = await page.evaluate(() => {
      const host = document.querySelector("pii-redactor");
      if (!host?.shadowRoot) return "";
      const el = host.shadowRoot.querySelector(".entity-list-header") as HTMLElement | null;
      return el?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    });
    // Should show "Detected items (N / N)" with N > 0
    expect(headerText).toMatch(/Detected items \(\d+ \/ \d+\)/);
    const [enabled, total] = headerText.match(/\d+/g)!.map(Number);
    expect(total).toBeGreaterThan(0);
    expect(enabled).toBe(total); // All enabled by default
  });

  test("user can toggle a redaction off via the entity list", async ({
    page,
  }) => {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.evaluate(() => {
        document.querySelector("pii-redactor")?.shadowRoot
          ?.querySelector<HTMLElement>(".dropzone")?.click();
      }),
    ]);
    await fileChooser.setFiles(TEST_IMAGE);
    await waitForPhase(page, "reviewing");

    // Uncheck the first entity
    await page.evaluate(() => {
      const host = document.querySelector("pii-redactor");
      const firstCheckbox = host?.shadowRoot?.querySelector<HTMLInputElement>(
        ".entity-item input[type=checkbox]",
      );
      firstCheckbox?.click();
    });

    await page.waitForTimeout(300); // allow Lit to re-render

    // Header should now show N-1 / N
    const headerText = await shadowText(page, ".entity-list-header");
    const [enabled, total] = headerText.match(/\d+/g)!.map(Number);
    expect(enabled).toBe(total - 1);
  });

  test("confirm & redact produces a redaction-complete event with a PNG blob", async ({
    page,
  }) => {
    let eventFired = false;
    let blobSize = 0;

    await page.exposeFunction("onRedactionComplete", (size: number) => {
      eventFired = true;
      blobSize = size;
    });

    await page.evaluate(() => {
      document.querySelector("pii-redactor")?.addEventListener(
        "redaction-complete",
        (e: any) => {
          (window as any).onRedactionComplete(e.detail.blob.size);
        },
      );
    });

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.evaluate(() => {
        document.querySelector("pii-redactor")?.shadowRoot
          ?.querySelector<HTMLElement>(".dropzone")?.click();
      }),
    ]);
    await fileChooser.setFiles(TEST_IMAGE);
    await waitForPhase(page, "reviewing");

    // Click confirm
    await page.evaluate(() => {
      const host = document.querySelector("pii-redactor");
      host?.shadowRoot?.querySelector<HTMLElement>(
        "button.primary",
      )?.click();
    });

    // Wait for the component to set window.__redactionDone (set after firing
    // the redaction-complete event), then verify the event was received.
    await page.waitForFunction(() => (window as any).__redactionDone, {
      timeout: 30_000,
    });
    expect(eventFired).toBe(true);
    expect(blobSize).toBeGreaterThan(1000); // Must be a real PNG, not empty
  });

  test("cancel button fires redaction-cancel and resets to idle", async ({
    page,
  }) => {
    let cancelFired = false;
    await page.exposeFunction("onRedactionCancel", () => {
      cancelFired = true;
    });
    await page.evaluate(() => {
      document.querySelector("pii-redactor")?.addEventListener(
        "redaction-cancel",
        () => (window as any).onRedactionCancel(),
      );
    });

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.evaluate(() => {
        document.querySelector("pii-redactor")?.shadowRoot
          ?.querySelector<HTMLElement>(".dropzone")?.click();
      }),
    ]);
    await fileChooser.setFiles(TEST_IMAGE);
    await waitForPhase(page, "reviewing");

    await page.evaluate(() => {
      const host = document.querySelector("pii-redactor");
      host?.shadowRoot?.querySelector<HTMLElement>("button.danger")?.click();
    });

    await page.waitForFunction(
      () => {
        const el = document.querySelector("pii-redactor") as any;
        return el?.phase === "idle";
      },
      { timeout: 5_000 },
    );

    expect(cancelFired).toBe(true);
    const phase = await shadowProp(page, "phase");
    expect(phase).toBe("idle");
  });
});

// ── Mobile viewport ───────────────────────────────────────────────────────────

test.describe("mobile viewport", () => {
  test("component renders correctly at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DEMO_URL);
    await page.waitForSelector("pii-redactor");

    const dropzoneVisible = await page.evaluate(() => {
      const host = document.querySelector("pii-redactor");
      const dz = host?.shadowRoot?.querySelector(".dropzone");
      if (!dz) return false;
      const rect = dz.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    expect(dropzoneVisible).toBe(true);
  });

  test("trust banner is visible on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DEMO_URL);
    await page.waitForSelector("pii-redactor");

    const bannerText = await shadowText(page, ".trust-banner");
    expect(bannerText).toContain("never leaves your device");
  });
});
