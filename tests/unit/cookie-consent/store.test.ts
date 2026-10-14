/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { COOKIE_CONSENT_STORAGE_KEY, COOKIE_CONSENT_VERSION } from "@/lib/cookie-consent/preference";
import { getStatus, getServerStatus, setAnalyticsConsent, subscribe } from "@/lib/cookie-consent/store";

function seed(analytics: boolean) {
  window.localStorage.setItem(
    COOKIE_CONSENT_STORAGE_KEY,
    JSON.stringify({ v: COOKIE_CONSENT_VERSION, analytics, at: new Date().toISOString() })
  );
}

beforeEach(() => {
  // Clear any in-memory override left by a previous test's failed write,
  // then clear storage for a clean slate.
  setAnalyticsConsent(false);
  window.localStorage.clear();
});

describe("getServerStatus", () => {
  it("is always unknown", () => {
    expect(getServerStatus()).toBe("unknown");
  });
});

describe("precedence contract", () => {
  it("stored grant + failed revoke write: memory override wins, event reports persisted:false", () => {
    seed(true);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    let detail: unknown;
    const handler = (e: Event) => {
      detail = (e as CustomEvent).detail;
    };
    window.addEventListener("careeros:cookie-consent", handler);
    try {
      setAnalyticsConsent(false);
      expect(getStatus()).toBe("denied");
      // The stale value is still what's physically in storage.
      expect(JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!).analytics).toBe(true);
      expect(detail).toEqual({ persisted: false });
    } finally {
      window.removeEventListener("careeros:cookie-consent", handler);
      setItemSpy.mockRestore();
    }
  });

  it("the window.localStorage getter throwing falls back to the in-memory path without throwing", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked: private mode");
      },
      configurable: true,
    });
    try {
      expect(() => getStatus()).not.toThrow();
      expect(getStatus()).toBe("unset");
      expect(() => setAnalyticsConsent(true)).not.toThrow();
      expect(getStatus()).toBe("granted");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("clearing the backing storage and firing a storage event with newValue:null resets status to unset", () => {
    seed(true);
    expect(getStatus()).toBe("granted");
    let notified = false;
    const unsubscribe = subscribe(() => {
      notified = true;
    });
    try {
      window.localStorage.clear();
      window.dispatchEvent(
        new StorageEvent("storage", { key: COOKIE_CONSENT_STORAGE_KEY, newValue: null })
      );
      expect(getStatus()).toBe("unset");
      expect(notified).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("a successful write survives a fresh module instance (simulated reload)", async () => {
    setAnalyticsConsent(true);
    expect(getStatus()).toBe("granted");

    vi.resetModules();
    const fresh = await import("@/lib/cookie-consent/store");
    expect(fresh.getStatus()).toBe("granted");
  });
});

describe("subscribe", () => {
  it("notifies on setAnalyticsConsent", () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    try {
      setAnalyticsConsent(true);
      expect(cb).toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("notifies on a cross-tab storage event and clears any in-memory override", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    setAnalyticsConsent(false);
    setItemSpy.mockRestore();
    expect(getStatus()).toBe("denied");

    seed(true);
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    try {
      window.dispatchEvent(
        new StorageEvent("storage", { key: COOKIE_CONSENT_STORAGE_KEY, newValue: "irrelevant" })
      );
      expect(cb).toHaveBeenCalled();
      expect(getStatus()).toBe("granted");
    } finally {
      unsubscribe();
    }
  });
});
