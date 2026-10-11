import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { FakeSupabase } from "../mocks/fake-supabase";

// Drives the real proxy → updateSession → ensureAnonymousCookie chain. The data-rights
// routes resolve identity read-only (#51); if the proxy minted an anonymous user before
// they ran, an export or delete without a cookie would create an account first.
const h = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabase,
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => h.fake.client() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: h.getUser } }),
}));

const { proxy } = await import("@/proxy");

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  h.fake = new FakeSupabase();
  h.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
});

describe("proxy on data-rights endpoints", () => {
  it.each(["/api/me", "/api/me/export"])("%s: no anonymous user, session or cookie is minted", async (path) => {
    const res = await proxy(request(path));
    expect(h.fake.writes).toEqual([]);
    expect(h.fake.rows("users")).toEqual([]);
    expect(h.fake.rows("anonymous_sessions")).toEqual([]);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/co_anon=/);
  });

  it.each(["/api/me", "/api/me/export"])("%s: the Supabase session is still refreshed", async (path) => {
    await proxy(request(path));
    expect(h.getUser).toHaveBeenCalledTimes(1);
  });

  it("does not treat lookalike paths as data-rights endpoints", async () => {
    const res = await proxy(request("/api/meetings"));
    expect(h.fake.rows("users")).toHaveLength(1);
    expect(res.headers.get("set-cookie")).toMatch(/co_anon=/);
  });

  it("still bootstraps the anonymous cookie on other routes", async () => {
    const res = await proxy(request("/chat"));
    expect(h.fake.rows("users")).toHaveLength(1);
    expect(h.fake.rows("anonymous_sessions")).toHaveLength(1);
    expect(res.headers.get("set-cookie")).toMatch(/co_anon=/);
  });
});
