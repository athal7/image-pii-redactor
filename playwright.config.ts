import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Pipeline tests complete in ~30–45s on warm cache. 120s gives 3× headroom
  // and avoids silently burning budget on genuinely stuck tests.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // Independent describe blocks (image-variety suites) run in parallel.
  // workers: 2 limits peak memory on CI (each worker holds Tesseract + NER WASM).
  fullyParallel: true,
  workers: 2,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Allow a persistent user data dir for model caching in CI.
        // Set via PLAYWRIGHT_USER_DATA_DIR env var; falls back to ephemeral.
        ...(process.env.PLAYWRIGHT_USER_DATA_DIR
          ? { userDataDir: process.env.PLAYWRIGHT_USER_DATA_DIR }
          : {}),
      },
    },
    // Mobile viewport — scoped to viewport/layout tests only.
    // Pipeline tests are WASM-based and viewport-independent; running them
    // again under a mobile UA wastes ~7 minutes and gains nothing.
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        // Share the same model cache dir so mobile-chrome doesn't cold-download
        // the 80MB NER model separately from chromium.
        ...(process.env.PLAYWRIGHT_USER_DATA_DIR
          ? { userDataDir: process.env.PLAYWRIGHT_USER_DATA_DIR }
          : {}),
      },
      grep: /mobile viewport/,
    },
  ],

  // Start the Vite dev server before tests.
  // In CI, set VITE_RUNNING=1 to skip launching a new server.
  // Locally, run `npm run dev` in a separate terminal first.
  ...(process.env.VITE_RUNNING
    ? {}
    : {
        webServer: {
          command: "npx vite",
          url: "http://localhost:5173",
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
