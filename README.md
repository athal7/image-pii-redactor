# image-pii-redactor

A Web Component that redacts personal information from AI chat screenshots entirely in the browser. No data ever leaves your device.

```html
<pii-redactor></pii-redactor>
```

Upload a screenshot → PII is detected and highlighted → review and adjust → export a redacted PNG.

## How it works

1. **OCR** — [Tesseract.js](https://github.com/naptha/tesseract.js) extracts text and word-level bounding boxes from the image
2. **PII detection** — A multilingual NER model ([`onnx-community/multilang-pii-ner-ONNX`](https://huggingface.co/onnx-community/multilang-pii-ner-ONNX)) via [Transformers.js](https://github.com/xenova/transformers.js) identifies names, addresses, phone numbers, etc. Regex patterns cover structured PII (SSN, credit card, email, IP address) as a fallback
3. **Review** — An SVG overlay lets you toggle, add, or remove redaction boxes before exporting
4. **Export** — The final redacted PNG is rendered on a Canvas and returned as a `Blob`

Everything runs in the browser. The OCR engine, NER model, and image processing use WebAssembly and WebGPU — no server, no API call, no telemetry.

## Install

```sh
npm install image-pii-redactor
```

## Usage

### As a Web Component

```html
<script type="module">
  import 'image-pii-redactor';
</script>

<pii-redactor></pii-redactor>
```

The component self-registers as `<pii-redactor>`. Drop it anywhere — it works in plain HTML, React, Vue, Svelte, or any framework.

### Listening for the result

```js
const redactor = document.querySelector('pii-redactor');

redactor.addEventListener('redaction-confirm', (e) => {
  const { blob, entities, width, height } = e.detail;
  // blob: PNG Blob with redactions burned in
  // entities: array of { label, bbox, source } — no PII, just metadata
});

redactor.addEventListener('redaction-cancel', () => {
  console.log('User cancelled');
});
```

### Configuration

```html
<pii-redactor
  lang="eng"
  min-confidence="0.7"
  use-regex="true"
  max-file-size="20971520"
></pii-redactor>
```

Or via JavaScript:

```js
redactor.config = {
  lang: 'eng',                                          // Tesseract language code
  nerModel: 'onnx-community/multilang-pii-ner-ONNX',   // HuggingFace model ID
  minConfidence: 0.7,                                   // NER confidence threshold
  useRegex: true,                                       // also run regex patterns
  maxFileSize: 20 * 1024 * 1024,                        // 20 MB
  memoryMode: 'auto',                                   // 'auto' | 'low' | 'normal'
};
```

`memoryMode: 'auto'` detects `navigator.deviceMemory` and uses sequential model loading (OCR → terminate → NER) on devices with less than 4 GB RAM.

### Programmatic pipeline

Use the pipeline directly without the UI component:

```js
import { analyzeImage, renderRedactedImage } from 'image-pii-redactor';

const result = await analyzeImage(imageBlob, {
  lang: 'eng',
  nerModel: 'onnx-community/multilang-pii-ner-ONNX',
  minConfidence: 0.7,
}, (progress) => console.log(progress.message));

// result.ocr       — full OCR text + word bboxes
// result.entities  — detected PII entities with char offsets
// result.redactions — proposed redaction boxes in pixel coords

const redactedBlob = await renderRedactedImage(imageBlob, result.redactions);
```

### Service Worker (offline + privacy firewall)

After the first load, the component works fully offline. Register the included Service Worker to cache model files and optionally block all outbound network requests:

1. Copy `node_modules/image-pii-redactor/public/pii-redactor-sw.js` to your web root
2. Register it on page load:

```js
import { registerServiceWorker } from 'image-pii-redactor';

await registerServiceWorker();
```

Once registered, the SW intercepts HuggingFace model downloads and caches them. After models are warm, you can enable the network firewall to block all external requests — verifiable proof that no image data leaves the browser:

```js
navigator.serviceWorker.controller.postMessage({ type: 'ENABLE_FIREWALL' });
```

## Privacy model

- **All processing is local.** OCR, NER inference, and image rendering run entirely in the browser using WebAssembly (WASM) and optionally WebGPU.
- **Models are cached after the first download.** Transformers.js and Tesseract.js both use the browser's Cache API and IndexedDB. Subsequent runs are instant and offline.
- **Airplane mode works.** After the first run, disconnect from the internet and reload — the tool continues to function. This is the user-facing proof that nothing is server-dependent.
- **The Service Worker provides a hard network fence.** When enabled, the SW blocks all non-cached outbound requests at the browser level, making it impossible for image data to be exfiltrated even by a compromised dependency.

## Browser support

| Feature | Requirement |
|---------|------------|
| OCR (Tesseract.js WASM) | Chrome 89+, Firefox 89+, Safari 15+ |
| NER (Transformers.js WASM) | Same as above |
| NER (WebGPU acceleration) | Chrome 113+, Edge 113+ |
| OffscreenCanvas (image pre-processing) | Chrome 69+, Firefox 105+ |
| Web Components | All modern browsers |

Safari is supported but WebGPU acceleration is not available — inference falls back to WASM automatically.

## Development

```sh
git clone https://github.com/athal7/image-pii-redactor
cd image-pii-redactor
npm install

npm run dev          # start demo at http://localhost:5173
npm test             # unit tests (Vitest, ~250ms)
npm run test:e2e:fast  # fast e2e tests, no model download needed
npm run build        # production library build
```

E2e tests that exercise the full model pipeline require the dev server to be running:

```sh
npm run dev &
npm run test:e2e
```

## License

[MPL-2.0](LICENSE) — Mozilla Public License 2.0. Modifications to library files must be published under the same license; combining with proprietary code in a larger work is permitted.
