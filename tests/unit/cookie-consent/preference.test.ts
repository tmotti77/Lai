import { describe, it, expect } from "vitest";
import {
  COOKIE_CONSENT_VERSION,
  COOKIE_CONSENT_STORAGE_KEY,
  readPreference,
  writePreference,
  clearPreference,
} from "@/lib/cookie-consent/preference";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    _map: map,
  };
}

describe("writePreference / readPreference round-trip", () => {
  it("persists analytics: true and reads it back", () => {
    const storage = fakeStorage();
    const now = new Date("2026-05-10T00:00:00.000Z");
    const result = writePreference(storage, true, now);
    expect(result.persisted).toBe(true);
    expect(result.preference).toEqual({ v: COOKIE_CONSENT_VERSION, analytics: true, at: now.toISOString() });
    expect(readPreference(storage)).toEqual(result.preference);
  });

  it("persists analytics: false and reads it back", () => {
    const storage = fakeStorage();
    const now = new Date("2026-05-10T00:00:00.000Z");
    const result = writePreference(storage, false, now);
    expect(result.persisted).toBe(true);
    expect(readPreference(storage)).toEqual({ v: COOKIE_CONSENT_VERSION, analytics: false, at: now.toISOString() });
  });
});

describe("readPreference", () => {
  it("returns null when nothing is stored", () => {
    expect(readPreference(fakeStorage())).toBeNull();
  });

  it("returns null for a version mismatch", () => {
    const storage = fakeStorage({
      [COOKIE_CONSENT_STORAGE_KEY]: JSON.stringify({ v: COOKIE_CONSENT_VERSION + 1, analytics: true, at: "x" }),
    });
    expect(readPreference(storage)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const storage = fakeStorage({ [COOKIE_CONSENT_STORAGE_KEY]: "{not json" });
    expect(readPreference(storage)).toBeNull();
  });

  it("returns null for a wrong shape", () => {
    const storage = fakeStorage({
      [COOKIE_CONSENT_STORAGE_KEY]: JSON.stringify({ v: COOKIE_CONSENT_VERSION, analytics: "yes", at: "x" }),
    });
    expect(readPreference(storage)).toBeNull();
  });

  it("returns null when storage is null", () => {
    expect(readPreference(null)).toBeNull();
  });

  it("returns null when getItem throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPreference(storage)).toBeNull();
  });
});

describe("writePreference failure", () => {
  it("returns persisted: false and the attempted preference when setItem throws, without throwing", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const now = new Date("2026-05-10T00:00:00.000Z");
    let result: ReturnType<typeof writePreference> | undefined;
    expect(() => {
      result = writePreference(storage, true, now);
    }).not.toThrow();
    expect(result).toEqual({
      preference: { v: COOKIE_CONSENT_VERSION, analytics: true, at: now.toISOString() },
      persisted: false,
    });
  });

  it("returns persisted: false when storage is null, without throwing", () => {
    const now = new Date("2026-05-10T00:00:00.000Z");
    const result = writePreference(null, false, now);
    expect(result.persisted).toBe(false);
    expect(result.preference).toEqual({ v: COOKIE_CONSENT_VERSION, analytics: false, at: now.toISOString() });
  });
});

describe("clearPreference", () => {
  it("removes the stored value so readPreference returns null", () => {
    const storage = fakeStorage();
    writePreference(storage, true, new Date());
    clearPreference(storage);
    expect(readPreference(storage)).toBeNull();
  });

  it("does not throw when storage is null", () => {
    expect(() => clearPreference(null)).not.toThrow();
  });

  it("does not throw when removeItem throws", () => {
    const storage = {
      getItem: () => null,
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => clearPreference(storage)).not.toThrow();
  });
});
