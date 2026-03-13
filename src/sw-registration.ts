/**
 * Service Worker registration helper for the PII redactor.
 *
 * The SW provides two capabilities:
 *
 * 1. **Model caching**: Intercepts HuggingFace model downloads and caches them
 *    in Cache Storage so subsequent loads are instant and fully offline.
 *
 * 2. **Network firewall** (optional): After models are cached, the SW can
 *    block all non-cached outbound requests. This is the technical proof that
 *    no PII ever leaves the browser — the user can verify it by going offline.
 *
 * ## Setup
 *
 * 1. Copy `pii-redactor-sw.js` from the package's `public/` directory to your
 *    web server's root (or wherever your SW scope should be).
 *
 * 2. Call `registerServiceWorker()` once on page load, before running any
 *    image analysis.
 *
 * ## Two-phase CSP trust model
 *
 * - **Phase 1 (loader page)**: `connect-src *` — allow model downloads
 * - **Phase 2 (app page)**: `connect-src 'none'` — block all outbound after cache
 *
 * The SW makes Phase 2 the default once models are warm. The app page can
 * serve with strict CSP without breaking model inference.
 */

export interface SwRegistrationOptions {
  /**
   * Path to the Service Worker file on the server.
   * Default: "/pii-redactor-sw.js"
   */
  swPath?: string;

  /**
   * Service Worker scope. Controls which pages the SW can intercept.
   * Default: the directory containing the SW file.
   */
  scope?: string;
}

/**
 * Register the PII redactor Service Worker.
 *
 * Safe to call in environments without SW support — returns null gracefully.
 *
 * @returns The ServiceWorkerRegistration, or null if SW is not supported or
 *          registration fails.
 */
export async function registerServiceWorker(
  options: SwRegistrationOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker) {
    return null;
  }

  const swPath = options.swPath ?? "/pii-redactor-sw.js";
  const registerOptions: RegistrationOptions = {};
  if (options.scope) {
    registerOptions.scope = options.scope;
  }

  try {
    const registration = await navigator.serviceWorker.register(swPath, registerOptions);
    return registration;
  } catch {
    return null;
  }
}

/**
 * Unregister all Service Workers in the current scope.
 *
 * Useful during development or when the user wants to fully reset.
 *
 * @returns true if at least one registration was removed.
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker) {
    return false;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const results = await Promise.all(registrations.map((r) => r.unregister()));
    return results.some(Boolean);
  } catch {
    return false;
  }
}
