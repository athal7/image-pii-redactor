import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 300_000, // 5 min — model download on first run
  expect: { timeout: 10_000 },
  fullyParallel: false, // Model downloads are heavy; run sequentially
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    // Allow enough time for model inference
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Mobile viewport for mobile-specific tests
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
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
