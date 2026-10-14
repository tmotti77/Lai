/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";
import { COOKIE_CONSENT_STORAGE_KEY, COOKIE_CONSENT_VERSION } from "@/lib/cookie-consent/preference";
import { setAnalyticsConsent } from "@/lib/cookie-consent/store";

// #63 step 2, critique P2: an essential-only cookie choice must never be read as, or coupled
// to, DB-backed processing/disclaimer consent. `lib/cookie-consent/**` must stay independent
// of `lib/consent.ts` / `ConsentDialog` at the import-graph level, not just at runtime.
const ROOT = path.resolve(__dirname, "../../..");
const FORBIDDEN_IMPORT = /from\s+["']@\/(lib\/consent|components\/chat\/ConsentDialog)["']/;

const files = globSync("lib/cookie-consent/**/*.{ts,tsx}", { cwd: ROOT }).sort();

describe("cookie-consent store stays decoupled from DB-backed consent", () => {
  it("matches the files it is meant to guard", () => {
    expect(files).toContain("lib/cookie-consent/store.ts");
    expect(files).toContain("lib/cookie-consent/preference.ts");
  });

  it.each(files)("%s imports neither lib/consent nor ConsentDialog", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src).not.toMatch(FORBIDDEN_IMPORT);
  });
});

describe("setAnalyticsConsent touches only the cookie-consent storage key", () => {
  beforeEach(() => {
    setAnalyticsConsent(false);
    window.localStorage.clear();
  });

  it("does not read or write co_anon / sb-* cookies", () => {
    const before = document.cookie;
    setAnalyticsConsent(true);
    expect(document.cookie).toBe(before);
    expect(document.cookie).not.toMatch(/co_anon|sb-/);
  });

  it("only writes the careeros.cookieConsent localStorage key", () => {
    const keysBefore = Object.keys(window.localStorage);
    setAnalyticsConsent(true);
    const keysAfter = Object.keys(window.localStorage);
    expect(keysAfter.filter((k) => !keysBefore.includes(k))).toEqual([COOKIE_CONSENT_STORAGE_KEY]);
    expect(JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!).v).toBe(COOKIE_CONSENT_VERSION);
  });
});
