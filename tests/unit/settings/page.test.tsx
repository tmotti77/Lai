/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { he } from "@/lib/i18n/he";

// The five render states of /settings (#51 part 2, plan §3.1 + critique #1/#2).
const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  enabled: vi.fn(() => true),
  capture: vi.fn(),
}));

vi.mock("@/lib/privacy/identity", () => {
  class SessionRejectedError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  class AuthUnavailableError extends Error {}
  return {
    resolveRequestIdentity: h.resolve,
    dataRightsEnabled: h.enabled,
    SessionRejectedError,
    AuthUnavailableError,
  };
});
vi.mock("@sentry/nextjs", () => ({ captureException: h.capture }));
vi.mock("@/components/settings/DataRightsPanel", () => ({
  DataRightsPanel: ({ isAnonymous }: { isAnonymous: boolean }) => (
    <div data-testid="panel" data-anonymous={String(isAnonymous)} />
  ),
}));

const { default: SettingsPage } = await import("@/app/(app)/settings/page");
const { SessionRejectedError, AuthUnavailableError } = await import("@/lib/privacy/identity");

const s = he.settings;
const ids = (isAnonymous: boolean) => ({ primaryId: "u1", linkedAnonymousId: null, isAnonymous });

beforeEach(() => {
  h.resolve.mockReset();
  h.enabled.mockReset().mockReturnValue(true);
  h.capture.mockReset();
});

describe("/settings page states", () => {
  it("kill switch: contact message, no identity lookup, no panel", async () => {
    h.enabled.mockReturnValue(false);
    render(await SettingsPage());
    expect(screen.getByText(s.disabled)).toBeInTheDocument();
    expect(screen.getByText(he.privacy.contactEmail, { exact: false })).toBeInTheDocument();
    expect(h.resolve).not.toHaveBeenCalled();
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("rejected session: sign in again, never the anonymous panel", async () => {
    h.resolve.mockRejectedValue(new SessionRejectedError("refresh_token_not_found"));
    render(await SettingsPage());
    expect(screen.getByText(s.sessionExpired)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: s.signInAgain })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("auth unavailable: alert + Sentry", async () => {
    h.resolve.mockRejectedValue(new AuthUnavailableError("down"));
    render(await SettingsPage());
    expect(screen.getByRole("alert")).toHaveTextContent(s.loadError);
    expect(h.capture).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: { context: "settings_page" } }));
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("unexpected error: alert + Sentry", async () => {
    h.resolve.mockRejectedValue(new Error("boom"));
    render(await SettingsPage());
    expect(screen.getByRole("alert")).toHaveTextContent(s.loadError);
    expect(h.capture).toHaveBeenCalled();
  });

  it("no identity: no-data message", async () => {
    h.resolve.mockResolvedValue({ authUser: null, ids: null });
    render(await SettingsPage());
    expect(screen.getByText(s.noData)).toBeInTheDocument();
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("auth-only account: panel, not anonymous", async () => {
    h.resolve.mockResolvedValue({ authUser: { id: "a1" }, ids: null });
    render(await SettingsPage());
    expect(screen.getByTestId("panel")).toHaveAttribute("data-anonymous", "false");
  });

  it.each([true, false])("account rows (isAnonymous=%s): panel", async (anon) => {
    h.resolve.mockResolvedValue({ authUser: anon ? null : { id: "a1" }, ids: ids(anon) });
    render(await SettingsPage());
    expect(screen.getByTestId("panel")).toHaveAttribute("data-anonymous", String(anon));
  });

  it("has a title and links to the privacy page", async () => {
    h.resolve.mockResolvedValue({ authUser: null, ids: ids(true) });
    render(await SettingsPage());
    expect(screen.getByRole("heading", { level: 1, name: s.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: s.privacyLink })).toHaveAttribute("href", "/privacy");
  });
});
