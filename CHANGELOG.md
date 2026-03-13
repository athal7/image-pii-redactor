## [0.1.0](https://github.com/athal7/image-pii-redactor/releases/tag/v0.1.0) (2026-03-13)

### Features

* Initial release: client-side PII redaction Web Component (`<pii-redactor>`)
* Tesseract.js OCR pipeline with dark-background preprocessing
* Transformers.js NER pipeline (multilang-pii-ner-ONNX, q4 quantized)
* Regex fallback for structured PII (emails, phones, SSNs, etc.)
* Manual box drawing, undo/redo, select/deselect all
* Service Worker for offline model caching
* Memory management: `memoryMode` config, `releaseNerModel()`

### Bug Fixes

* Remove `capture` attribute from file input (forced camera-only on mobile)
* Fix touch drawing by toggling `touch-action` on scroll container
* Fix NER token fragmentation with `aggregation_strategy: "first"`
* Fix `padBBox` clamping to image dimensions
* Reduce model download from ~85 MB to ~45 MB (q4 dtype, WASM on mobile)
