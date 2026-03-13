import { css } from "lit";

export const redactorStyles = css`
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    color: #1a1a2e;
    --accent: #0060df; /* Mozilla blue */
    --accent-hover: #0250bb;
    --danger: #d73a49;
    --success: #2da44e;
    --bg: #ffffff;
    --bg-secondary: #f6f8fa;
    --border: #d0d7de;
    --text: #1a1a2e;
    --text-secondary: #656d76;
    --redaction-fill: rgba(0, 0, 0, 0.75);
    --redaction-stroke: #ff3b3b;
    --radius: 8px;
    --max-width: 100%;
    container-type: inline-size;
  }

  * {
    box-sizing: border-box;
  }

  .container {
    max-width: var(--max-width);
    margin: 0 auto;
  }

  /* --- Trust banner --- */
  .trust-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: #e8f5e9;
    border: 1px solid #a5d6a7;
    border-radius: var(--radius);
    font-size: 13px;
    color: #2e7d32;
    margin-bottom: 12px;
  }

  .trust-banner .shield-icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
  }

  /* --- Drop zone --- */
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    min-height: 240px;
    padding: 32px 24px;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    background: var(--bg-secondary);
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    text-align: center;
    -webkit-tap-highlight-color: transparent;
  }

  .dropzone.dragover {
    border-color: var(--accent);
    background: #f0f6ff;
  }

  .dropzone-icon {
    width: 48px;
    height: 48px;
    color: var(--text-secondary);
  }

  .dropzone-text {
    font-size: 16px;
    color: var(--text-secondary);
  }

  .dropzone-text strong {
    color: var(--accent);
  }

  .dropzone-hint {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .file-input {
    display: none;
  }

  /* --- Progress --- */
  .progress-container {
    padding: 32px 24px;
    text-align: center;
  }

  .progress-bar-track {
    width: 100%;
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    overflow: hidden;
    margin: 16px 0;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .progress-message {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 8px 0;
  }

  .progress-phase {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 4px;
  }

  /* --- Editor / review --- */
  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .viewport {
    position: relative;
    background: #e5e5e5;
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }

  .viewport-inner {
    position: relative;
    display: inline-block;
    /* Scale image to fit viewport width on mobile */
    width: 100%;
  }

  .viewport img {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
  }

  .viewport svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    touch-action: pan-x pan-y;
  }

  /* In draw mode there's no scroll container clipping the SVG, so
     touch-action:none on the SVG itself is sufficient to block the
     page scroll gesture and let the draw drag register. */
  .viewport svg.draw-mode {
    touch-action: none;
  }

  .viewport svg rect.redaction-box {
    fill: var(--redaction-fill);
    stroke: var(--redaction-stroke);
    stroke-width: 2;
    cursor: pointer;
    transition: fill 0.15s;
  }

  .viewport svg rect.redaction-box:hover,
  .viewport svg rect.redaction-box.active {
    fill: rgba(255, 59, 59, 0.4);
    stroke-width: 3;
  }

  .viewport svg rect.redaction-box.disabled {
    fill: rgba(0, 0, 0, 0.15);
    stroke: #999;
    stroke-dasharray: 4 2;
  }

  .viewport svg rect.drawing {
    fill: rgba(0, 96, 223, 0.2);
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 6 3;
  }

  /* --- Toolbar --- */
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 0;
  }

  .toolbar button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    -webkit-tap-highlight-color: transparent;
    /* Touch-friendly minimum size */
    min-height: 44px;
    min-width: 44px;
  }

  .toolbar button:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
  }

  .toolbar button:active {
    background: #e8e8e8;
  }

  .toolbar button.primary {
    background: var(--success);
    color: white;
    border-color: var(--success);
  }

  .toolbar button.primary:hover {
    background: #278c41;
  }

  .toolbar button.danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  .toolbar button.danger:hover {
    background: #fff5f5;
  }

  .toolbar button.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .toolbar .spacer {
    flex: 1;
  }

  /* --- Entity list (bottom sheet on mobile, sidebar on desktop) --- */
  .entity-list {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    max-height: 200px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .entity-list-header {
    position: sticky;
    top: 0;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .entity-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
    min-height: 44px; /* Touch target */
  }

  .entity-item:last-child {
    border-bottom: none;
  }

  .entity-item input[type="checkbox"] {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--accent);
  }

  .entity-label {
    display: inline-block;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    border-radius: 4px;
    background: #eef1f5;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .entity-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .entity-source {
    font-size: 11px;
    color: var(--text-secondary);
  }

  /* --- Error state --- */
  .error {
    padding: 24px;
    text-align: center;
    color: var(--danger);
  }

  .error button {
    margin-top: 12px;
    padding: 8px 16px;
    border: 1px solid var(--danger);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--danger);
    cursor: pointer;
    min-height: 44px;
  }

  /* --- Done state --- */
  .done {
    padding: 32px 24px;
    text-align: center;
  }

  .done-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--success);
    margin-bottom: 20px;
  }

  .done-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }

  .done-actions button {
    display: inline-flex;
    align-items: center;
    padding: 10px 20px;
    font-size: 15px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    min-height: 44px;
    -webkit-tap-highlight-color: transparent;
  }

  .done-actions button.primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .done-actions button:hover {
    background: var(--bg-secondary);
  }

  .done-actions button.primary:hover {
    background: var(--accent-hover);
  }

  .done-network {
    margin-top: 20px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .done-network-zero {
    color: var(--success);
    font-weight: 500;
  }

  /* --- Responsive --- */
  @container (min-width: 640px) {
    .editor {
      display: grid;
      grid-template-columns: 1fr 260px;
      grid-template-rows: auto 1fr;
      gap: 12px;
    }

    .toolbar {
      grid-column: 1 / -1;
    }

    .entity-list {
      max-height: none;
      grid-row: 2;
      grid-column: 2;
    }
  }

  /* --- Reduced motion --- */
  @media (prefers-reduced-motion: reduce) {
    .progress-bar-fill {
      transition: none;
    }
  }
`;
