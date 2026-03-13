import { LitElement, html, svg, nothing, type PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { redactorStyles } from "./styles.js";
import { shieldIcon, uploadIcon } from "./icons.js";
import { analyzeImage } from "../pipeline/index.js";
import { renderRedactedImage } from "../pipeline/redact.js";
import { preloadNerModel } from "../pipeline/pii-ner.js";
import type {
  Phase,
  Redaction,
  PiiEntity,
  OcrResult,
  RedactorConfig,
  RedactionResult,
  ProgressEvent,
  BBox,
  DEFAULT_CONFIG,
} from "../types.js";
import { DEFAULT_CONFIG as DEFAULTS } from "../types.js";

/**
 * <pii-redactor> — Client-side PII redaction for screenshot images.
 *
 * All OCR and PII detection runs in the browser. Your data never leaves
 * your device.
 *
 * @fires redaction-complete - When the user confirms redactions. Detail: RedactionResult.
 * @fires redaction-cancel - When the user cancels.
 * @fires error - When an error occurs. Detail: { message: string }.
 */
@customElement("pii-redactor")
export class PiiRedactor extends LitElement {
  static override styles = redactorStyles;

  // --- Public properties (configurable via attributes) ---

  @property({ type: String }) lang = DEFAULTS.lang;
  @property({ type: String, attribute: "ner-model" }) nerModel =
    DEFAULTS.nerModel;
  @property({ type: Number, attribute: "max-file-size" }) maxFileSize =
    DEFAULTS.maxFileSize;
  @property({ type: Number, attribute: "min-confidence" }) minConfidence =
    DEFAULTS.minConfidence;

  // --- Internal state ---

  @state() private phase: Phase = "idle";
  @state() private progress = 0;
  @state() private progressMessage = "";
  @state() private errorMessage = "";
  @state() private imageUrl = "";
  @state() private imageWidth = 0;
  @state() private imageHeight = 0;
  @state() private redactions: Redaction[] = [];
  @state() private entities: PiiEntity[] = [];
  @state() private ocrResult: OcrResult | null = null;
  @state() private dragOver = false;
  @state() private isDrawing = false;
  @state() private drawMode = false;
  @state() private drawStart: { x: number; y: number } | null = null;
  @state() private drawCurrent: { x: number; y: number } | null = null;
  @state() private networkRequestCount = 0;
  @state() private redactedBlob: Blob | null = null;

  private imageFile: File | null = null;
  private imageElement: HTMLImageElement | null = null;
  private undoStack: Redaction[][] = [];
  private perfObserver: PerformanceObserver | null = null;

  @query(".file-input") private fileInput!: HTMLInputElement;

  override connectedCallback(): void {
    super.connectedCallback();
    // Count real network requests so the trust banner shows live data.
    // PerformanceObserver is available in all modern browsers.
    if (typeof PerformanceObserver !== "undefined") {
      this.perfObserver = new PerformanceObserver(() => {
        this.networkRequestCount++;
      });
      try {
        this.perfObserver.observe({ type: "resource", buffered: true });
      } catch {
        // Some environments don't support resource timing — ignore
        this.perfObserver = null;
      }
    }
  }

  // --- Public methods ---

  /** Pre-load AI models. Call this to warm up the cache ahead of time. */
  async preload(): Promise<void> {
    await preloadNerModel(this.nerModel, (e) => this.handleProgress(e));
  }

  /** Reset to the initial idle state. */
  reset(): void {
    this.phase = "idle";
    this.progress = 0;
    this.progressMessage = "";
    this.errorMessage = "";
    this.redactions = [];
    this.entities = [];
    this.ocrResult = null;
    this.imageFile = null;
    this.undoStack = [];
    this.drawMode = false;
    if (this.imageUrl) {
      URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = "";
    }
    this.imageElement = null;
    this.redactedBlob = null;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.perfObserver?.disconnect();
    this.perfObserver = null;
  }

  // --- Rendering ---

  override render() {
    return html`
      <div class="container">
        ${this.renderTrustBanner()}
        ${this.phase === "idle" ? this.renderDropZone() : nothing}
        ${this.phase === "loading" ||
        this.phase === "ocr" ||
        this.phase === "detecting"
          ? this.renderProgress()
          : nothing}
        ${this.phase === "reviewing" ? this.renderEditor() : nothing}
        ${this.phase === "exporting" ? this.renderProgress() : nothing}
        ${this.phase === "done" ? this.renderDone() : nothing}
        ${this.errorMessage ? this.renderError() : nothing}
      </div>
    `;
  }

  private renderTrustBanner() {
    return html`
      <div class="trust-banner">
        ${shieldIcon}
        <span>Your data never leaves your device. All processing happens in
          your browser.</span>
        <span class="network-count"
          >Network: ${this.networkRequestCount} requests</span
        >
      </div>
    `;
  }

  private renderDropZone() {
    return html`
      <div
        class="dropzone ${this.dragOver ? "dragover" : ""}"
        @click=${this.handleDropZoneClick}
        @dragover=${this.handleDragOver}
        @dragleave=${this.handleDragLeave}
        @drop=${this.handleDrop}
      >
        ${uploadIcon}
        <div class="dropzone-text">
          <strong>Choose a screenshot</strong> or drag it here
        </div>
        <div class="dropzone-hint">
          PNG, JPG, or WebP up to
          ${Math.round(this.maxFileSize / 1024 / 1024)}MB
        </div>
        <input
          class="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          @change=${this.handleFileSelect}
        />
      </div>
    `;
  }

  private renderProgress() {
    const phaseLabels: Record<string, string> = {
      loading: "Loading AI models",
      ocr: "Reading text from image",
      detecting: "Detecting personal information",
      exporting: "Preparing redacted image",
    };

    return html`
      <div class="progress-container">
        <div class="progress-phase">
          ${phaseLabels[this.phase] ?? "Processing..."}
        </div>
        <div class="progress-bar-track">
          <div
            class="progress-bar-fill"
            style="width: ${Math.round(this.progress * 100)}%"
          ></div>
        </div>
        <div class="progress-message">${this.progressMessage}</div>
      </div>
    `;
  }

  private renderEditor() {
    const vb = `0 0 ${this.imageWidth} ${this.imageHeight}`;

    return html`
      <div class="editor">
        <div class="toolbar">
          <button
            class="${this.drawMode ? "active" : ""}"
            @click=${this.toggleDrawMode}
            title="Draw a redaction box manually"
          >
            ${this.drawMode ? "Drawing..." : "+ Add box"}
          </button>
          <button
            @click=${this.handleUndo}
            ?disabled=${this.undoStack.length === 0}
          >
            Undo
          </button>
          <button
            @click=${this.handleSelectAll}
          >
            Select all
          </button>
          <button
            @click=${this.handleDeselectAll}
          >
            Deselect all
          </button>
          <span class="spacer"></span>
          <button class="danger" @click=${this.handleCancel}>Cancel</button>
          <button class="primary" @click=${this.handleConfirm}>
            Confirm &amp; redact
          </button>
        </div>

        <div class="viewport">
          <div class="viewport-inner">
            <img
              src=${this.imageUrl}
              alt="Screenshot to redact"
              @load=${this.handleImageLoad}
            />
            <svg
              class=${this.drawMode ? "draw-mode" : ""}
              viewBox=${vb}
              preserveAspectRatio="xMidYMid meet"
              xmlns="http://www.w3.org/2000/svg"
              @pointerdown=${this.handleSvgPointerDown}
              @pointermove=${this.handleSvgPointerMove}
              @pointerup=${this.handleSvgPointerUp}
              @pointercancel=${this.handleSvgPointerCancel}
            >
              ${this.redactions.map(
                (r) => svg`
                  <rect
                    class="redaction-box ${r.enabled ? "" : "disabled"}"
                    x=${r.bbox.x0}
                    y=${r.bbox.y0}
                    width=${r.bbox.x1 - r.bbox.x0}
                    height=${r.bbox.y1 - r.bbox.y0}
                    data-id=${r.id}
                    @click=${(e: Event) => this.handleRedactionClick(e, r.id)}
                  >
                    <title>${r.label ?? "Redaction"}: ${r.enabled ? "enabled" : "disabled"}</title>
                  </rect>
                `,
              )}
              ${this.isDrawing && this.drawStart && this.drawCurrent
                ? svg`
                    <rect
                      class="drawing"
                      x=${Math.min(this.drawStart.x, this.drawCurrent.x)}
                      y=${Math.min(this.drawStart.y, this.drawCurrent.y)}
                      width=${Math.abs(this.drawCurrent.x - this.drawStart.x)}
                      height=${Math.abs(this.drawCurrent.y - this.drawStart.y)}
                    />
                  `
                : nothing}
            </svg>
          </div>
        </div>

        <div class="entity-list">
          <div class="entity-list-header">
            Detected items (${this.redactions.filter((r) => r.enabled).length}
            / ${this.redactions.length})
          </div>
          ${this.redactions.map(
            (r) => html`
              <label class="entity-item">
                <input
                  type="checkbox"
                  .checked=${r.enabled}
                  @change=${(e: Event) =>
                    this.handleToggleRedaction(
                      r.id,
                      (e.target as HTMLInputElement).checked,
                    )}
                />
                <span class="entity-label">${r.label ?? "manual"}</span>
                <span class="entity-text"
                  >${this.getRedactionText(r)}</span
                >
                <span class="entity-source">${r.source}</span>
              </label>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderError() {
    return html`
      <div class="error">
        <p>${this.errorMessage}</p>
        <button @click=${this.reset}>Try again</button>
      </div>
    `;
  }

  private renderDone() {
    const canShare =
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      this.redactedBlob != null &&
      navigator.canShare({
        files: [new File([this.redactedBlob], "redacted.png", { type: "image/png" })],
      });

    return html`
      <div class="done">
        <div class="done-title">Redaction complete</div>
        <div class="done-actions">
          <button class="primary" @click=${this.handleDownload}>
            Download
          </button>
          ${canShare
            ? html`<button @click=${this.handleShare}>Share</button>`
            : nothing}
          <button @click=${this.reset}>Redact another</button>
        </div>
      </div>
    `;
  }

  // --- File handling ---

  private handleDropZoneClick() {
    this.fileInput?.click();
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragOver = true;
  }

  private handleDragLeave() {
    this.dragOver = false;
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  private handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.processFile(file);
    // Reset input so the same file can be selected again
    input.value = "";
  }

  private async processFile(file: File) {
    // Validate
    if (!DEFAULTS.acceptedTypes.includes(file.type)) {
      this.errorMessage = `Unsupported file type: ${file.type}. Please use PNG, JPEG, or WebP.`;
      return;
    }
    if (file.size > this.maxFileSize) {
      this.errorMessage = `File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum is ${Math.round(this.maxFileSize / 1024 / 1024)}MB.`;
      return;
    }

    this.errorMessage = "";
    this.imageFile = file;
    this.imageUrl = URL.createObjectURL(file);
    this.phase = "loading";

    try {
      // Load image to get dimensions
      const img = await this.loadImage(this.imageUrl);
      this.imageElement = img;
      this.imageWidth = img.naturalWidth;
      this.imageHeight = img.naturalHeight;

      // Run the pipeline
      const config: RedactorConfig = {
        lang: this.lang,
        nerModel: this.nerModel,
        minConfidence: this.minConfidence,
      };

      const result = await analyzeImage(file, config, (e) =>
        this.handleProgress(e),
      );

      this.ocrResult = result.ocr;
      this.entities = result.entities;
      this.redactions = result.redactions;
      this.undoStack = [];
      this.phase = "reviewing";
    } catch (err) {
      console.error("Pipeline error:", err);
      this.errorMessage =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      this.phase = "idle";
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = src;
    });
  }

  // --- Progress ---

  private handleProgress(event: ProgressEvent) {
    this.phase = event.phase;
    this.progress = event.progress;
    this.progressMessage = event.message;
  }

  // --- Redaction editing ---

  private handleRedactionClick(e: Event, id: string) {
    e.stopPropagation();
    if (this.drawMode) return;

    const redaction = this.redactions.find((r) => r.id === id);
    if (redaction) {
      this.pushUndo();
      this.redactions = this.redactions.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r,
      );
    }
  }

  private handleToggleRedaction(id: string, enabled: boolean) {
    this.pushUndo();
    this.redactions = this.redactions.map((r) =>
      r.id === id ? { ...r, enabled } : r,
    );
  }

  private handleSelectAll() {
    this.pushUndo();
    this.redactions = this.redactions.map((r) => ({ ...r, enabled: true }));
  }

  private handleDeselectAll() {
    this.pushUndo();
    this.redactions = this.redactions.map((r) => ({ ...r, enabled: false }));
  }

  private handleUndo() {
    const prev = this.undoStack.pop();
    if (prev) {
      this.redactions = prev;
      // Trigger reactivity for undoStack
      this.undoStack = [...this.undoStack];
    }
  }

  private pushUndo() {
    this.undoStack = [...this.undoStack, [...this.redactions]];
  }

  // --- Drawing manual boxes ---

  private toggleDrawMode() {
    this.drawMode = !this.drawMode;
    this.isDrawing = false;
    this.drawStart = null;
    this.drawCurrent = null;
  }

  private svgPointFromEvent(e: PointerEvent): { x: number; y: number } {
    const svg = (e.currentTarget as SVGSVGElement) ?? this.renderRoot.querySelector("svg");
    if (!svg) return { x: 0, y: 0 };

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };

    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }

  private handleSvgPointerDown(e: PointerEvent) {
    if (!this.drawMode) return;

    const point = this.svgPointFromEvent(e);
    this.drawStart = point;
    this.drawCurrent = point;
    this.isDrawing = true;

    // Capture pointer for smooth drawing
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private handleSvgPointerMove(e: PointerEvent) {
    if (!this.isDrawing || !this.drawStart) return;
    this.drawCurrent = this.svgPointFromEvent(e);
    e.preventDefault();
  }

  private handleSvgPointerUp(e: PointerEvent) {
    if (!this.isDrawing || !this.drawStart || !this.drawCurrent) return;

    const x0 = Math.min(this.drawStart.x, this.drawCurrent.x);
    const y0 = Math.min(this.drawStart.y, this.drawCurrent.y);
    const x1 = Math.max(this.drawStart.x, this.drawCurrent.x);
    const y1 = Math.max(this.drawStart.y, this.drawCurrent.y);

    // Only add if the box is at least 10px in image space
    if (x1 - x0 > 10 && y1 - y0 > 10) {
      this.pushUndo();
      const newRedaction: Redaction = {
        id: `manual-${Date.now()}`,
        bbox: { x0, y0, x1, y1 },
        source: "manual",
        enabled: true,
        label: "MANUAL",
      };
      this.redactions = [...this.redactions, newRedaction];
    }

    this.isDrawing = false;
    this.drawStart = null;
    this.drawCurrent = null;
    this.drawMode = false;
  }

  private handleSvgPointerCancel() {
    // Touch was interrupted (e.g. incoming call, scroll takeover) — abort draw
    this.isDrawing = false;
    this.drawStart = null;
    this.drawCurrent = null;
    // Keep drawMode on so the user can try again
  }

  // --- Actions ---

  private async handleConfirm() {
    if (!this.imageElement) return;

    this.phase = "exporting";
    this.progress = 0.5;
    this.progressMessage = "Rendering redacted image...";

    try {
      const result = await renderRedactedImage(
        this.imageElement,
        this.redactions,
      );

      this.dispatchEvent(
        new CustomEvent<RedactionResult>("redaction-complete", {
          detail: result,
          bubbles: true,
          composed: true,
        }),
      );

      this.redactedBlob = result.blob;
      this.phase = "done";
    } catch (err) {
      console.error("Export error:", err);
      this.errorMessage =
        err instanceof Error ? err.message : "Failed to export redacted image.";
      this.phase = "reviewing";
    }
  }

  private handleCancel() {
    this.dispatchEvent(
      new CustomEvent("redaction-cancel", {
        bubbles: true,
        composed: true,
      }),
    );
    this.reset();
  }

  private handleDownload() {
    if (!this.redactedBlob) return;
    const url = URL.createObjectURL(this.redactedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this.imageFile
      ? `redacted-${this.imageFile.name.replace(/\.[^.]+$/, "")}.png`
      : "redacted.png";
    a.click();
    URL.revokeObjectURL(url);
  }

  private async handleShare() {
    if (!this.redactedBlob) return;
    const filename = this.imageFile
      ? `redacted-${this.imageFile.name.replace(/\.[^.]+$/, "")}.png`
      : "redacted.png";
    const file = new File([this.redactedBlob], filename, { type: "image/png" });
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      // AbortError means user dismissed the share sheet — not an error
      if (err instanceof Error && err.name !== "AbortError") {
        this.errorMessage = "Share failed. Try downloading instead.";
      }
    }
  }

  // --- Helpers ---

  private getRedactionText(r: Redaction): string {
    if (r.source === "manual") return "(manually drawn)";
    if (!r.entityId || !this.ocrResult) return "";
    const entity = this.entities.find((e) => e.id === r.entityId);
    return entity?.text ?? "";
  }

  private handleImageLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    this.imageWidth = img.naturalWidth;
    this.imageHeight = img.naturalHeight;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pii-redactor": PiiRedactor;
  }
}
