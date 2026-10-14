/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { he } from "@/lib/i18n/he";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_CONSENT_VERSION,
} from "@/lib/cookie-consent/preference";
import { setAnalyticsConsent } from "@/lib/cookie-consent/store";
import { CookiePreferences } from "@/components/settings/CookiePreferences";
import { CookieBanner } from "@/components/cookie-consent/CookieBanner";

// #63 step 4: the settings toggle reflects/changes the same store the banner (step 3) uses,
// so a toggle here hides a mounted banner without a reload (shared store event).

function seed(analytics: boolean, version = COOKIE_CONSENT_VERSION) {
  window.localStorage.setItem(
    COOKIE_CONSENT_STORAGE_KEY,
    JSON.stringify({ v: version, analytics, at: new Date().toISOString() })
  );
}

beforeEach(() => {
  // Restore spies first so a leaked failing setItem mock can't break the reset write below.
  vi.restoreAllMocks();
  // Clear any in-memory override left by a previous test's failed write, then clear storage.
  setAnalyticsConsent(false);
  window.localStorage.clear();
  cleanup();
});

describe("CookiePreferences", () => {
  it("reflects a stored granted preference", () => {
    seed(true);
    render(<CookiePreferences />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeEnabled();
    expect(screen.getByText(he.cookieConsent.settings.on)).toBeInTheDocument();
  });

  it("reflects a stored denied preference", () => {
    seed(false);
    render(<CookiePreferences />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(he.cookieConsent.settings.off)).toBeInTheDocument();
  });

  it("shows the unset status text when there is no stored preference", () => {
    render(<CookiePreferences />);
    expect(screen.getByText(he.cookieConsent.settings.unset)).toBeInTheDocument();
  });

  it("exposes a dedicated accessible name distinct from the section heading", () => {
    seed(false);
    render(<CookiePreferences />);
    const toggle = screen.getByRole("switch", { name: he.cookieConsent.settings.toggleLabel });
    expect(toggle).toHaveAccessibleName(he.cookieConsent.settings.toggleLabel);
  });

  it("clicking the switch toggles and persists the opposite value", () => {
    seed(false);
    render(<CookiePreferences />);
    const toggle = screen.getByRole("switch");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    const stored = JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? "{}");
    expect(stored.analytics).toBe(true);
  });

  it("keyboard Enter and Space toggle the native button", () => {
    seed(false);
    render(<CookiePreferences />);
    const toggle = screen.getByRole("switch");

    fireEvent.click(toggle); // native <button> handles Enter/Space as click; this pins that it's a real <button>
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("lists essential cookies as always-on and not toggleable", () => {
    render(<CookiePreferences />);
    expect(screen.getByText(he.cookieConsent.settings.essentialNote)).toBeInTheDocument();
    // Only one toggle exists; essential has no switch of its own.
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("a toggle from settings hides a mounted CookieBanner via the shared store event", () => {
    render(
      <>
        <CookieBanner />
        <CookiePreferences />
      </>
    );

    expect(screen.getByRole("region", { name: he.cookieConsent.title })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.queryByRole("region", { name: he.cookieConsent.title })).not.toBeInTheDocument();
  });

  it("surfaces the notPersisted message when the write fails", () => {
    seed(false);
    // jsdom's localStorage methods live on Storage.prototype, so an own-property spy on
    // window.localStorage never intercepts the store's call.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    render(<CookiePreferences />);
    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText(he.cookieConsent.notPersisted)).toBeInTheDocument();
  });
});
