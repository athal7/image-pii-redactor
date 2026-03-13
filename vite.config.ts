import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  worker: {
    // Use ES module format for workers so dynamic imports (Transformers.js)
    // work correctly. IIFE format doesn't support code-splitting.
    format: "es",
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "ImagePiiRedactor",
      fileName: "image-pii-redactor",
      formats: ["es"],
    },
    rollupOptions: {
      external: [],
    },
    target: "es2022",
    sourcemap: true,
  },
  server: {
    open: "/demo/index.html",
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  test: {
    // Pipeline tests are pure Node — no DOM needed, no jsdom dep required
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    globals: true,
  },
});
