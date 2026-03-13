# Agent Instructions

## What this repo is

`image-pii-redactor` is a Web Component (`<pii-redactor>`) that redacts PII from
AI-chat screenshots entirely in the browser. Nothing leaves the device until the
user confirms and the host app uploads the already-redacted blob.

**Stack:** LitElement · Tesseract.js (OCR) · Transformers.js /
`onnx-community/multilang-pii-ner-ONNX` (NER) · Canvas API

**Pipeline:**
```
Upload image → OCR (Tesseract.js) → PII detection (NER + regex) →
Span→bbox bridge → SVG review overlay → Canvas export → redacted PNG blob
```

## Commands

| Task | Command |
|------|---------|
| Unit tests | `npm test` |
| Unit tests (watch) | `npm run test:watch` |
| E2e tests (full) | `npm run test:e2e` — requires `npm run dev` in another terminal |
| E2e tests (fast, no model) | `npm run test:e2e:fast` |
| Lint | `npm run lint` |
| Build library | `npm run build` |
| Build demo | `npm run build:demo` |
| Dev server | `npm run dev` |

## Key files

```
src/
  index.ts                        — public API exports
  types.ts                        — shared types + LABEL_DISPLAY_NAMES map
  component/
    pii-redactor.ts               — LitElement Web Component
    icons.ts                      — SVG icon literals
  pipeline/
    index.ts                      — orchestrates OCR + NER + regex + merge
    ocr.ts                        — Tesseract.js wrapper
    pii-ner.ts                    — thin proxy; posts messages to ner-worker
    ner-aggregation.ts            — pure BIO token aggregation functions
    pii-regex.ts                  — regex patterns for SSN, email, phone, etc.
    bridge.ts                     — maps NER char spans → OCR word bboxes
    redact.ts                     — Canvas export of redacted image
    preprocess.ts                 — image preprocessing helpers
  workers/
    ner-worker.ts                 — Web Worker: all Transformers.js inference
    ner-worker-protocol.ts        — typed request/response message types
tests/
  e2e/redactor.spec.ts            — Playwright end-to-end tests
```

## Architecture decisions

- **Web Component** — framework-agnostic; embeds in any Next.js or static page.
- **NER runs in a Web Worker** — `pii-ner.ts` is a thin postMessage proxy;
  `ner-worker.ts` holds the Transformers.js pipeline singleton. Main thread stays
  unblocked during inference.
- **NER + regex in parallel** — NER handles context-dependent PII; regex handles
  structured PII (SSN, phone, email). `mergeEntities` deduplicates overlaps,
  preferring NER results.
- **Word-level OCR bboxes** — character-level is too noisy; line-level too coarse.
  Word-level + span-overlap mapping is the right granularity for the bridge.
- **SVG overlay for review, Canvas for export** — SVG gives free touch/pointer
  events; Canvas gives a reliable, auditable export path.
- **Lazy model loading** — models download only when the user selects a file.
  Transformers.js and Tesseract.js both cache in the browser's Cache API /
  IndexedDB automatically.
- **No Service Worker registered by the component** — the npm package must not
  register SWs in the host app's scope. Provide a `registerServiceWorker()`
  export if offline support is needed.

## Testing conventions

- All unit tests live alongside source in `src/**/__tests__/`.
- Test files import from `.js` extensions (ESM resolution): e.g.,
  `import { foo } from "../foo.js"`.
- The worker (`ner-worker.ts`) exports `handleWorkerMessage` and
  `_resetWorkerState` for test injection — call `_resetWorkerState()` in
  `beforeEach` to clear the pipeline singleton between tests.
- The proxy (`pii-ner.ts`) exports `_setWorkerFactory` for injecting a mock
  Worker in unit tests.
- E2e tests require a running dev/preview server on port 5173. Set
  `VITE_RUNNING=1` to skip the built-in server launch.

## CI

| Workflow | Trigger | What it runs |
|----------|---------|--------------|
| `publish-npm.yml` | push to main | `npm test` (unit) + semantic-release |
| `deploy-demo.yml` | push to main | `npm run build:demo` + GitHub Pages deploy |
| `e2e.yml` | push/PR to main | `npm run build:demo` + Playwright e2e |

The NER model (~80MB) is cached in CI via the Chromium user data dir at
`/tmp/pw-model-cache`, keyed on the model ID.
