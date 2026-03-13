import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Vite config for building the GitHub Pages demo site.
 *
 * Unlike the library build (vite.config.ts), this produces a full static site
 * from demo/index.html, with the library source bundled inline.
 *
 * Output goes to dist-demo/ so it doesn't conflict with the library dist/.
 */
export default defineConfig({
  root: "demo",
  base: process.env.VITE_BASE ?? "/image-pii-redactor/", // GitHub Pages repo subdirectory
  worker: {
    // Use ES module format for workers so dynamic imports (Transformers.js)
    // work correctly. IIFE format doesn't support code-splitting.
    format: "es",
  },
  resolve: {
    alias: {
      // Point the demo's `../src/index.ts` import at the real source
      // so the demo build includes the full library bundled in.
      "image-pii-redactor": resolve(__dirname, "src/index.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist-demo"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "demo/index.html"),
    },
  },
  server: {
    open: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
