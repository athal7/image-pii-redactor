// Web Component — auto-registers <pii-redactor>
export { PiiRedactor } from "./component/pii-redactor.js";

// Pipeline — for programmatic use without the UI
export {
  analyzeImage,
  runOcr,
  detectPiiNer,
  preloadNerModel,
  releaseNerModel,
  detectPiiRegex,
  entitiesToRedactions,
  mergeEntities,
  renderRedactedImage,
  drawRedactionPreview,
  preprocessForOcr,
  computeAverageLuminance,
  isDarkBackground,
  DARK_THRESHOLD,
} from "./pipeline/index.js";

// Service Worker helpers
export {
  registerServiceWorker,
  unregisterServiceWorker,
} from "./sw-registration.js";
export type { SwRegistrationOptions } from "./sw-registration.js";

// Types
export type {
  BBox,
  OcrWord,
  OcrResult,
  PiiEntity,
  Redaction,
  Phase,
  ProgressEvent,
  RedactionResult,
  RedactorConfig,
} from "./types.js";

export { DEFAULT_CONFIG } from "./types.js";
