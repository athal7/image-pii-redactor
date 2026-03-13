/**
 * Unit tests for the Service Worker registration helper.
 *
 * The actual SW is not loaded here — we test the helper's behavior in
 * environments with and without SW support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerServiceWorker,
  unregisterServiceWorker,
  type SwRegistrationOptions,
} from "../sw-registration.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fake ServiceWorkerRegistration */
const fakeReg = {
  unregister: vi.fn().mockResolvedValue(true),
  scope: "https://example.com/",
};

/** Fake navigator.serviceWorker */
function mockSwSupported() {
  const mockSw = {
    register: vi.fn().mockResolvedValue(fakeReg),
    getRegistrations: vi.fn().mockResolvedValue([fakeReg]),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: mockSw,
    configurable: true,
    writable: true,
  });
  return mockSw;
}

function mockSwUnsupported() {
  Object.defineProperty(navigator, "serviceWorker", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("registerServiceWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when Service Workers are not supported", async () => {
    mockSwUnsupported();
    const result = await registerServiceWorker();
    expect(result).toBeNull();
  });

  it("calls navigator.serviceWorker.register with default SW path", async () => {
    const mockSw = mockSwSupported();
    await registerServiceWorker();
    expect(mockSw.register).toHaveBeenCalledWith(
      "/pii-redactor-sw.js",
      expect.any(Object),
    );
  });

  it("accepts a custom swPath option", async () => {
    const mockSw = mockSwSupported();
    await registerServiceWorker({ swPath: "/custom/sw.js" });
    expect(mockSw.register).toHaveBeenCalledWith(
      "/custom/sw.js",
      expect.any(Object),
    );
  });

  it("passes scope option to navigator.serviceWorker.register", async () => {
    const mockSw = mockSwSupported();
    await registerServiceWorker({ scope: "/app/" });
    expect(mockSw.register).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ scope: "/app/" }),
    );
  });

  it("returns the registration object on success", async () => {
    mockSwSupported();
    const result = await registerServiceWorker();
    expect(result).toBe(fakeReg);
  });

  it("returns null and does not throw when registration fails", async () => {
    const mockSw = {
      register: vi.fn().mockRejectedValue(new Error("SW registration failed")),
      getRegistrations: vi.fn().mockResolvedValue([]),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      value: mockSw,
      configurable: true,
      writable: true,
    });

    const result = await registerServiceWorker();
    expect(result).toBeNull();
  });
});

describe("unregisterServiceWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when Service Workers are not supported", async () => {
    mockSwUnsupported();
    expect(await unregisterServiceWorker()).toBe(false);
  });

  it("calls unregister on all existing registrations", async () => {
    const mockSw = mockSwSupported();
    await unregisterServiceWorker();
    expect(mockSw.getRegistrations).toHaveBeenCalled();
    expect(fakeReg.unregister).toHaveBeenCalled();
  });

  it("returns true when at least one registration was removed", async () => {
    mockSwSupported();
    fakeReg.unregister.mockResolvedValue(true);
    const result = await unregisterServiceWorker();
    expect(result).toBe(true);
  });
});
