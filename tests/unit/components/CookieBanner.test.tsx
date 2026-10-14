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
import { CookieBanner } from "@/components/cookie-consent/CookieBanner";

// #63 step 3: the banner is non-modal, normal-flow (decisions 6-7), default-deny until a
// choice is made, and its accessible name is the visible title (decision 9).

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

describe("CookieBanner", () => {
  it("shows the banner with both buttons and links when there is no stored preference", () => {
    render(<CookieBanner />);

    const region = screen.getByRole("region", { name: he.cookieConsent.title });
    expect(region).toBeInTheDocument();
    expect(screen.getByRole("button", { name: he.cookieConsent.acceptAnalytics })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: he.cookieConsent.essentialOnly })).toBeInTheDocument();

    const privacyLink = screen.getByRole("link", { name: he.cookieConsent.privacyLink });
    expect(privacyLink).toHaveAttribute("href", "/privacy");
    const settingsLink = screen.getByRole("link", { name: he.cookieConsent.settingsLink });
    expect(settingsLink).toHaveAttribute("href", "/settings");
  });

  it("does not render when a valid preference is already stored", () => {
    seed(true);
    render(<CookieBanner />);
    expect(screen.queryByRole("region", { name: he.cookieConsent.title })).not.toBeInTheDocument();
  });

  it("re-shows when the stored preference is an older version", () => {
    seed(true, COOKIE_CONSENT_VERSION - 1);
    render(<CookieBanner />);
    expect(screen.getByRole("region", { name: he.cookieConsent.title })).toBeInTheDocument();
  });

  it("essential-only hides the banner, persists analytics:false, and never blocks a sibling composer", () => {
    render(
      <>
        <CookieBanner />
        <input aria-label="composer" />
      </>
    );

    const composer = screen.getByLabelText("composer");
    expect(composer).toBeEnabled();
    expect(document.activeElement).not.toBe(screen.getByRole("region", { name: he.cookieConsent.title }));
    expect(document.querySelector("[aria-modal]")).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: he.cookieConsent.essentialOnly }));

    expect(screen.queryByRole("region", { name: he.cookieConsent.title })).not.toBeInTheDocument();
    expect(composer).toBeEnabled();
    fireEvent.change(composer, { target: { value: "hi" } });
    expect(composer).toHaveValue("hi");

    const stored = JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? "{}");
    expect(stored.analytics).toBe(false);
  });

  it("accept hides the banner and persists analytics:true", () => {
    render(<CookieBanner />);

    fireEvent.click(screen.getByRole("button", { name: he.cookieConsent.acceptAnalytics }));

    expect(screen.queryByRole("region", { name: he.cookieConsent.title })).not.toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? "{}");
    expect(stored.analytics).toBe(true);
  });

  it("both buttons carry the equal-weight secondary variant and a 44px minimum target", () => {
    render(<CookieBanner />);

    const accept = screen.getByRole("button", { name: he.cookieConsent.acceptAnalytics });
    const essential = screen.getByRole("button", { name: he.cookieConsent.essentialOnly });
    for (const button of [accept, essential]) {
      expect(button.className).toMatch(/min-h-11/);
    }
    // Equal weight: same variant/size classes on both buttons (decision 8).
    expect(accept.className).toBe(essential.className);
  });

  it("surfaces the notPersisted message when the write fails", () => {
    // jsdom's localStorage methods live on Storage.prototype, so an own-property spy on
    // window.localStorage never intercepts the store's call.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    render(<CookieBanner />);
    fireEvent.click(screen.getByRole("button", { name: he.cookieConsent.essentialOnly }));

    expect(screen.queryByRole("region", { name: he.cookieConsent.title })).not.toBeInTheDocument();
    expect(screen.getByText(he.cookieConsent.notPersisted)).toBeInTheDocument();
  });
});
