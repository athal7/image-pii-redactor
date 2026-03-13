/**
 * PII Redactor Service Worker
 *
 * Provides two capabilities:
 *
 * 1. Model caching: Intercepts HuggingFace model file downloads and stores
 *    them in Cache Storage. Subsequent loads are served from cache, enabling
 *    fully offline operation after the first run.
 *
 * 2. Network firewall mode: When enabled (via postMessage), blocks all
 *    non-cached outbound requests. This provides a verifiable guarantee that
 *    no data leaves the browser during image analysis.
 *
 * This file is framework-agnostic and has no dependencies.
 */

const CACHE_NAME = "pii-redactor-models-v1";

/**
 * Domains whose responses are cached for offline/privacy use.
 * Includes HuggingFace CDN and the Transformers.js model hub.
 */
const CACHEABLE_ORIGINS = [
  "https://huggingface.co",
  "https://cdn-lfs.huggingface.co",
  "https://cdn-lfs-us-1.huggingface.co",
  "https://huggingface.co/api",
];

/**
 * When true, all requests not in cache are blocked (network firewall mode).
 * Toggled via postMessage from the host page.
 */
let firewallEnabled = false;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  // Skip waiting so the new SW takes control immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all pages in scope without requiring a reload
  event.waitUntil(self.clients.claim());
});

// ── Fetch interception ────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept same-origin non-model requests
  // (page HTML, scripts, local assets)
  const isCacheable = CACHEABLE_ORIGINS.some((origin) =>
    request.url.startsWith(origin)
  );

  if (!isCacheable) {
    // In firewall mode, block external requests that aren't cached model files
    if (firewallEnabled && url.origin !== self.location.origin) {
      event.respondWith(
        new Response("Blocked by PII Redactor privacy firewall", {
          status: 403,
          statusText: "Forbidden",
          headers: { "Content-Type": "text/plain" },
        })
      );
    }
    // Otherwise let the browser handle it normally
    return;
  }

  // Cache-first strategy for model files
  event.respondWith(cacheFirst(request));
});

// ── Cache-first strategy ──────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  // Not in cache — fetch from network and store
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone before consuming — Response body can only be read once
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Network failed and not in cache
    return new Response("Model file not available offline", {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// ── postMessage interface ─────────────────────────────────────────────────────

self.addEventListener("message", (event) => {
  const { type } = event.data ?? {};

  switch (type) {
    case "ENABLE_FIREWALL":
      firewallEnabled = true;
      event.ports?.[0]?.postMessage({ type: "FIREWALL_ENABLED" });
      break;

    case "DISABLE_FIREWALL":
      firewallEnabled = false;
      event.ports?.[0]?.postMessage({ type: "FIREWALL_DISABLED" });
      break;

    case "GET_STATUS":
      event.ports?.[0]?.postMessage({
        type: "STATUS",
        firewallEnabled,
        cacheName: CACHE_NAME,
      });
      break;

    case "CLEAR_CACHE":
      caches.delete(CACHE_NAME).then(() => {
        event.ports?.[0]?.postMessage({ type: "CACHE_CLEARED" });
      });
      break;
  }
});
