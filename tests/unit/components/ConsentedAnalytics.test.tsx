/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { COOKIE_CONSENT_STORAGE_KEY, COOKIE_CONSENT_VERSION } from "@/lib/cookie-consent/preference";
import { setAnalyticsConsent } from "@/lib/cookie-consent/store";

// #63 step 2: <Analytics> only ever mounts through this wrapper, gated on the stored
// cookie-consent choice, and revoke must null out any event already in flight via beforeSend.
const h = vi.hoisted(() => ({ analyticsSpy: vi.fn() }));
vi.mock("@vercel/analytics/next", () => ({
  Analytics: (props: { beforeSend?: (e: unknown) => unknown }) => {
    h.analyticsSpy(props);
    return <div data-testid="vercel-analytics-marker" />;
  },
}));

const { ConsentedAnalytics } = await import("@/components/cookie-consent/ConsentedAnalytics");

function seed(analytics: boolean) {
  window.localStorage.setItem(
    COOKIE_CONSENT_STORAGE_KEY,
    JSON.stringify({ v: COOKIE_CONSENT_VERSION, analytics, at: new Date().toISOString() })
  );
}

beforeEach(() => {
  // Clear any in-memory override left by a previous test's failed write, then clear storage.
  setAnalyticsConsent(false);
  window.localStorage.clear();
  h.analyticsSpy.mockClear();
  cleanup();
});

describe("ConsentedAnalytics", () => {
  it("renders nothing with no stored preference", () => {
    render(<ConsentedAnalytics />);
    expect(screen.queryByTestId("vercel-analytics-marker")).not.toBeInTheDocument();
    expect(h.analyticsSpy).not.toHaveBeenCalled();
  });

  it("renders nothing when the stored preference denies analytics", () => {
    seed(false);
    render(<ConsentedAnalytics />);
    expect(screen.queryByTestId("vercel-analytics-marker")).not.toBeInTheDocument();
  });

  it("renders the Vercel Analytics component when the stored preference grants analytics", () => {
    seed(true);
    render(<ConsentedAnalytics />);
    expect(screen.getByTestId("vercel-analytics-marker")).toBeInTheDocument();
  });

  it("appears without a reload after setAnalyticsConsent(true)", async () => {
    render(<ConsentedAnalytics />);
    expect(screen.queryByTestId("vercel-analytics-marker")).not.toBeInTheDocument();

    setAnalyticsConsent(true);

    await waitFor(() => expect(screen.getByTestId("vercel-analytics-marker")).toBeInTheDocument());
  });

  it("passes a beforeSend that nulls events once revoked, and passes them through while granted", () => {
    seed(true);
    render(<ConsentedAnalytics />);
    expect(h.analyticsSpy).toHaveBeenCalledTimes(1);
    const { beforeSend } = h.analyticsSpy.mock.calls[0][0] as { beforeSend: (e: unknown) => unknown };

    const event = { url: "/chat" };
    expect(beforeSend(event)).toBe(event);

    setAnalyticsConsent(false);
    expect(beforeSend(event)).toBeNull();
  });
});
