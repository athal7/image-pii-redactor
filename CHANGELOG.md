## [0.3.4](https://github.com/athal7/image-pii-redactor/compare/v0.3.3...v0.3.4) (2026-03-13)


### Bug Fixes

* **component:** restructure toolbar into utils row + actions row ([4402af3](https://github.com/athal7/image-pii-redactor/commit/4402af3c9126a8d7bf2694795a7c1eb7443b3657))

## [0.3.3](https://github.com/athal7/image-pii-redactor/compare/v0.3.2...v0.3.3) (2026-03-13)


### Bug Fixes

* **component:** make toolbar sticky so controls stay visible while scrolling ([dec07a9](https://github.com/athal7/image-pii-redactor/commit/dec07a97f46ae5c08c0e6ae22cd8694c7103b9b0))

## [0.3.2](https://github.com/athal7/image-pii-redactor/compare/v0.3.1...v0.3.2) (2026-03-13)


### Bug Fixes

* **component:** restore touch-action:none on SVG in draw mode ([42e7eae](https://github.com/athal7/image-pii-redactor/commit/42e7eae1b63f02818a05a111b9504c5aa71ff254))

## [0.3.1](https://github.com/athal7/image-pii-redactor/compare/v0.3.0...v0.3.1) (2026-03-13)


### Bug Fixes

* **component:** remove viewport max-height and overflow to show full image ([ad50d22](https://github.com/athal7/image-pii-redactor/commit/ad50d22c566ed6b46db83920c1dade6adb6e3aa2))

# [0.3.0](https://github.com/athal7/image-pii-redactor/compare/v0.2.0...v0.3.0) (2026-03-13)


### Bug Fixes

* **component:** fix network counter showing page-load requests ([2ee67e6](https://github.com/athal7/image-pii-redactor/commit/2ee67e6c22ef447aa03780ec28533069a1d93cee))


### Features

* **component:** smart preload + move network counter to done screen ([56f9dcc](https://github.com/athal7/image-pii-redactor/commit/56f9dccba7812c9843d03bcc0a4b60a68c681b9e))

# [0.2.0](https://github.com/athal7/image-pii-redactor/compare/v0.1.1...v0.2.0) (2026-03-13)


### Features

* **component:** add download and share after redaction ([e168ca6](https://github.com/athal7/image-pii-redactor/commit/e168ca68b5acb99ecd6c01b21527cec9a53d513f))

## [0.1.1](https://github.com/athal7/image-pii-redactor/compare/v0.1.0...v0.1.1) (2026-03-13)


### Bug Fixes

* **component:** always disable viewport scroll to fix touch tap on boxes ([cf5f647](https://github.com/athal7/image-pii-redactor/commit/cf5f6475c3b07e40e7b7a3a51402db21f65e1b80))

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
