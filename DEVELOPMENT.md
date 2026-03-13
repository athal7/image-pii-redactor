# Development Status

## What this is

`image-pii-redactor` is a Web Component (`<pii-redactor>`) that lets users
redact PII from AI-chat screenshots entirely in the browser before uploading
them to a server. It was built for the Mozilla Data Collective initiative.

**Stack:** LitElement · Tesseract.js (OCR) · Transformers.js / `onnx-community/multilang-pii-ner-ONNX` (NER) · Canvas API

**Privacy guarantee:** OCR, NER, and image rendering all run in the browser.
Nothing touches a server until the user explicitly confirms and the host app
uploads the already-redacted blob.

---

## Current state

The core pipeline is built and working end-to-end in the demo page:

```
Upload image → OCR (Tesseract.js) → PII detection (NER + regex) →
Span→bbox bridge → SVG review overlay → Canvas export → redacted PNG blob
```

**Test coverage**

| Suite | Command | Count | Speed |
|---|---|---|---|
| Unit (Vitest) | `npm test` | 47 tests | ~250ms |
| E2e fast (Playwright, no model) | `npm run test:e2e:fast` | 5 tests | ~2s |
| E2e full (Playwright, with model) | `npm run test:e2e` | 12 tests | ~5 min first run |

> The e2e tests require the dev server to be running first: `npm run dev`

---

## Known bugs

| Severity | Location | Description |
|---|---|---|
| **Medium** | `component/pii-redactor.ts:62` | `networkRequestCount` is always `0` — it's displayed in the trust banner but never incremented. Needs a `PerformanceObserver` wiring to be real. |
| **Medium** | `tests/e2e/redactor.spec.ts:260` | The confirm-export e2e test waits on `window.__redactionDone` which is never set. The test passes only because of an unconditional 3s `waitForTimeout` afterwards. Needs a proper `page.waitForFunction` on the event. |
| **Low** | `pipeline/ocr.ts:95` | `imageWidth`/`imageHeight` fall back to `0` if Tesseract doesn't expose them (type gap). A 0×0 canvas would silently produce a broken export. Should assert dimensions > 0. |
| **Low** | `pipeline/ocr.ts:40` | `worker.terminate()` is only called in the happy path. If `worker.recognize()` throws, the Tesseract worker is leaked. Need `try/finally`. |
| **Low** | `pipeline/bridge.ts:padBBox` | Bounding box padding clamps `x0`/`y0` to ≥ 0 but does not clamp `x1`/`y1` to image dimensions. Redactions can extend outside the image edges. |

---

## Known issues (not bugs, but needs attention before v1)

| Area | Location | Description |
|---|---|---|
| **Type error** | `pipeline/index.ts:15`, `component/pii-redactor.ts:17` | `DEFAULT_CONFIG` is imported inside an `import type {}` block but it is a runtime value, not a type. Will fail with strict `isolatedModules`. Remove from the type import. |
| **Debug logging** | `pipeline/index.ts`, `pii-ner.ts`, `bridge.ts` | 9 `console.debug` calls remain from development. Strip before publishing. |
| **Global mutation** | `pii-ner.ts:294` | `env.allowLocalModels = false` modifies the Transformers.js global environment on every `loadPipeline` call. Should be called once at module load time. |
| **Missing attribute** | `pii-redactor.ts` | `useRegex` config option exists in `RedactorConfig` and `DEFAULT_CONFIG` but has no `@property()` decorator — not configurable via HTML attribute. Add `@property({ type: Boolean, attribute: 'use-regex' })`. |
| **False positives** | `pii-regex.ts` | ZIPCODE pattern matches any 5-digit number (years, page numbers, etc.). CREDITCARD pattern is overly broad and overlaps SSN/phone patterns. Consider removing ZIPCODE from auto-redact or adding a minimum confidence context check. |
| **Dead export** | `component/icons.ts` | `cameraIcon` is exported but never used. Remove or wire up. |
| **Dead directory** | `src/workers/` | Empty placeholder. Remove or implement (see roadmap below). |
| **Missing ESLint config** | `package.json` | `lint` script runs `eslint src/` but there is no ESLint config file. Running `npm run lint` will error. Either add the config or remove the script. |

---

## Remaining work / roadmap

### High priority

**1. Fix NER token fragmentation**

The `onnx-community/multilang-pii-ner-ONNX` model with `aggregation_strategy: "simple"` is returning raw BIO tokens instead of aggregated entities in some cases (sub-word pieces like `"sa"`, `"rah"` instead of `"sarah"`). Our fallback aggregation handles it, but the word-to-entity mapping in the bridge can produce multiple small redaction boxes for one entity.

Fix: investigate whether passing `aggregation_strategy: "first"` or `"max"` to the Transformers.js pipeline produces better character offsets. If not, improve the BIO aggregation in `pii-ner.ts` to reconstruct whole-word boundaries before returning entities.

**2. Fix OCR accuracy on dark-background screenshots**

Real AI chat apps (ChatGPT, Claude, Gemini) use dark themes. The current test shows OCR misses text in the user's blue message bubbles entirely — only extracting from the lighter AI response bubbles. Tesseract.js accuracy degrades on low-contrast or non-white backgrounds.

Fix: pre-process the image before OCR. Options:
- Convert to grayscale: `ctx.filter = 'grayscale(1)'`
- Invert dark images: detect average luminosity; if dark, invert before OCR
- Increase contrast: `ctx.filter = 'contrast(2) brightness(1.5)'`
- Run OCR twice: once on original, once on inverted; merge word lists

This should be implemented in `pipeline/ocr.ts` as an optional preprocessing step controlled by a `preprocessForDarkMode` option.

### Medium priority

**3. Service Worker for offline + network firewall**

The "airplane mode" trust claim in the demo is currently aspirational — the component doesn't register a Service Worker. After the first model download, the component should continue working offline.

Implement:
- A `sw.ts` Service Worker that caches all app assets and model files on install
- After activation, intercept all `fetch` events and serve from cache
- Transformers.js and Tesseract.js both use the Cache API internally, but a top-level SW guarantees the page itself also works offline
- The SW should be registered by the host app, not the component (the component is an npm package — it should not register SWs autonomously). Provide a `registerServiceWorker()` export that the host can call.
- Document the CSP two-phase approach for production: a "loader" page that downloads models (network allowed), and an "app" page served with `Content-Security-Policy: connect-src 'none'` after models are cached.

**4. Memory management for mobile**

Loading both Tesseract.js WASM (~50MB runtime) and the NER model (~80–200MB) simultaneously can exhaust memory on mobile devices.

Fix: sequence instead of parallelize.
- Load and run OCR first, terminate the Tesseract worker (`worker.terminate()`) before loading the NER model
- Expose a `memoryMode: 'sequential' | 'parallel'` config option (default `'sequential'` on mobile, `'parallel'` on desktop)
- Detect mobile via `navigator.deviceMemory < 4` or the `'Mobi'` user agent string and default accordingly
- Add a warning banner if `navigator.deviceMemory` is below a threshold

### Low priority

**5. Strip debug logging**

Remove the 9 `console.debug` calls in `pipeline/index.ts`, `pii-ner.ts`, and `bridge.ts` before the first npm publish. Use a build-time flag (`import.meta.env.DEV`) or a small logger abstraction instead.

**6. Web Worker offloading for NER**

Currently Transformers.js inference runs on the main thread (or WebGPU from the main thread), which blocks rendering during inference. For a better UX on slower devices, move `detectPiiNer` into a Web Worker using the message-passing pattern from the Transformers.js documentation. The `src/workers/` directory was created as a placeholder for this.

This is `src/workers/ner-worker.ts` + a comlink or raw `postMessage` bridge in `pii-ner.ts`.

**7. Improve entity label display**

The entity list currently shows raw model labels (`GIVENNAME`, `TELEPHONENUM`, `STREET`). These should be mapped to human-readable labels for the review UI (`First name`, `Phone number`, `Street address`). Add a `LABEL_DISPLAY_NAMES` map to `types.ts`.

---

## Architecture decisions (already made)

- **Web Component over React component** — framework-agnostic, embeds in any Next.js or static page
- **SVG overlay for review, Canvas for export** — SVG gives free touch/pointer events for editing; Canvas gives a reliable, auditable export path
- **Lazy model loading on file select** — models only download when the user commits to the flow; Transformers.js and Tesseract.js both cache in the browser's Cache API / IndexedDB automatically
- **NER + regex in parallel** — NER handles context-dependent PII (names, locations); regex handles structured PII (SSN, phone, email) that NER models miss. `mergeEntities` deduplicates overlaps, preferring NER results
- **Word-level OCR bboxes** — character-level is too noisy; line-level is too coarse. Word-level + span-overlap mapping is the right granularity for the bridge
- **No Service Worker registered by the component** — the npm package should not register SWs in the host app's scope. Provide a `registerServiceWorker()` export instead.
