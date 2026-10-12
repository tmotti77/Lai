import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { FakeSupabase } from "../mocks/fake-supabase";

// Codex P1 (#51 part 2 critique #1): on /settings the proxy's getUser() used to clear a
// rejected session's cookies before the page ran, so the page (and the DELETE it offers)
// fell back to the co_anon footprint while the signed-in account stayed. The proxy must
// still refresh a valid session (RSCs can't write cookies) but never clear a rejected one,
// and never mint an anonymous user there.
type CookieOpts = { cookies: { setAll: (c: { name: string; value: string; options?: object }[]) => void } };

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabase,
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => h.fake.client() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: CookieOpts) => ({
    auth: { getUser: () => h.getUser(opts) },
  }),
}));

const { proxy } = await import("@/proxy");

const SESSION = "sb-stub-auth-token";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });
}

/** What supabase-js does when the server rejects the session: wipe the cookies, return the error. */
function rejectWith(code: string) {
  return async (opts: CookieOpts) => {
    opts.cookies.setAll([{ name: SESSION, value: "", options: { maxAge: 0 } }]);
    return { data: { user: null }, error: new AuthApiError("rejected", 400, code) };
  };
}

beforeEach(() => {
  h.fake = new FakeSupabase();
  h.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
});

describe("proxy on /settings", () => {
  it.each(["refresh_token_not_found", "session_expired", "bad_jwt"])(
    "rejected session (%s) + live co_anon: auth cookies reach the page untouched",
    async (code) => {
      h.getUser.mockImplementation(rejectWith(code));
      const res = await proxy(request("/settings", `${SESSION}=stale; co_anon=abc`));

      expect(h.getUser).toHaveBeenCalled();
      expect(res.headers.get("set-cookie") ?? "").not.toMatch(new RegExp(`${SESSION}=`));
      // Cookies forwarded to the RSC still carry the rejected session, so the page sees
      // SessionRejectedError instead of silently resolving to the anonymous identity.
      expect(res.headers.get("x-middleware-request-cookie")).toContain(`${SESSION}=stale`);
      expect(h.fake.writes).toEqual([]);
    },
  );

  it("a thrown getUser (auth service down) changes nothing and does not throw", async () => {
    h.getUser.mockRejectedValue(new AuthRetryableFetchError("down", 0));
    const res = await proxy(request("/settings", `${SESSION}=ok; co_anon=abc`));
    expect(res.headers.get("set-cookie") ?? "").toBe("");
  });

  it("a valid session is still refreshed and written in the proxy", async () => {
    h.getUser.mockImplementation(async (opts: CookieOpts) => {
      opts.cookies.setAll([{ name: SESSION, value: "fresh", options: { path: "/" } }]);
      return { data: { user: { id: "auth-1" } }, error: null };
    });
    const res = await proxy(request("/settings", `${SESSION}=expired`));
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION}=fresh`));
    expect(res.headers.get("x-middleware-request-cookie")).toContain(`${SESSION}=fresh`);
  });

  it("no session at all: cookie writes (if any) are applied normally", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const res = await proxy(request("/settings"));
    expect(res.status).toBe(200);
  });

  it.each(["/settings", "/settings/"])("%s: never mints an anonymous user", async (path) => {
    const res = await proxy(request(path));
    expect(h.fake.rows("users")).toEqual([]);
    expect(h.fake.rows("anonymous_sessions")).toEqual([]);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/co_anon=/);
  });

  it("lookalike paths keep the normal behaviour", async () => {
    const res = await proxy(request("/settingsx"));
    expect(h.fake.rows("users")).toHaveLength(1);
    expect(res.headers.get("set-cookie")).toMatch(/co_anon=/);
  });

  it("other pages still apply supabase's cookie writes on rejection (unchanged)", async () => {
    h.getUser.mockImplementation(rejectWith("refresh_token_not_found"));
    const res = await proxy(request("/chat", `${SESSION}=stale; co_anon=abc`));
    expect(res.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${SESSION}=;`));
  });
});
