import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeSupabase as FakeSupabaseT } from "../mocks/fake-supabase";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabaseT,
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => h.fake.client() }));

import { FakeSupabase } from "../mocks/fake-supabase";
import { resolveCurrentUserIds } from "@/lib/anonymous";

const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

function anonUser(token: string, expiresAt = FUTURE) {
  const u = h.fake.insertRow("users", { is_anonymous: true });
  h.fake.insertRow("anonymous_sessions", { token, user_id: u.id, expires_at: expiresAt });
  return u.id as string;
}

beforeEach(() => {
  h.fake = new FakeSupabase();
  h.cookies.clear();
});

describe("resolveCurrentUserIds (read-only)", () => {
  it("authed user with a row → that row, and nothing is written", async () => {
    const u = h.fake.insertRow("users", { auth_id: "auth-a", is_anonymous: false });
    expect(await resolveCurrentUserIds("auth-a")).toEqual({
      primaryId: u.id,
      authId: "auth-a",
      isAnonymous: false,
      linkedAnonymousId: null,
    });
    expect(h.fake.writes).toEqual([]);
  });

  it("authed user with no row + live co_anon → the anon row is primary and is NOT promoted", async () => {
    const anonId = anonUser("tok-1");
    h.cookies.set("co_anon", "tok-1");
    const ids = await resolveCurrentUserIds("auth-new");
    expect(ids).toEqual({ primaryId: anonId, authId: "auth-new", isAnonymous: false, linkedAnonymousId: null });
    expect(h.fake.rows("users").find((r) => r.id === anonId)).toMatchObject({ is_anonymous: true, auth_id: undefined });
    expect(h.fake.writes).toEqual([]);
  });

  it("authed user with a row + co_anon for a different unpromoted row → linkedAnonymousId", async () => {
    const u = h.fake.insertRow("users", { auth_id: "auth-a", is_anonymous: false });
    const anonId = anonUser("tok-2");
    h.cookies.set("co_anon", "tok-2");
    expect(await resolveCurrentUserIds("auth-a")).toMatchObject({ primaryId: u.id, linkedAnonymousId: anonId });
  });

  it("co_anon pointing at an already-promoted row is never linked", async () => {
    const u = h.fake.insertRow("users", { auth_id: "auth-a", is_anonymous: false });
    const other = h.fake.insertRow("users", { auth_id: "auth-other", is_anonymous: false });
    h.fake.insertRow("anonymous_sessions", { token: "tok-3", user_id: other.id, expires_at: FUTURE });
    h.cookies.set("co_anon", "tok-3");
    expect(await resolveCurrentUserIds("auth-a")).toMatchObject({ primaryId: u.id, linkedAnonymousId: null });
  });

  it("anonymous visitor whose cookie maps to a promoted row gets nothing (no cookie-only access to an account)", async () => {
    const other = h.fake.insertRow("users", { auth_id: "auth-other", is_anonymous: false });
    h.fake.insertRow("anonymous_sessions", { token: "tok-4", user_id: other.id, expires_at: FUTURE });
    h.cookies.set("co_anon", "tok-4");
    expect(await resolveCurrentUserIds()).toBeNull();
  });

  it("anonymous with a live cookie → that row", async () => {
    const anonId = anonUser("tok-5");
    h.cookies.set("co_anon", "tok-5");
    expect(await resolveCurrentUserIds()).toEqual({
      primaryId: anonId,
      authId: null,
      isAnonymous: true,
      linkedAnonymousId: null,
    });
  });

  it.each([
    ["expired", "tok-6", "tok-6", PAST],
    ["unknown", "tok-7", "nope", FUTURE],
  ])("%s cookie → null", async (_label, token, cookie, expiresAt) => {
    anonUser(token, expiresAt);
    h.cookies.set("co_anon", cookie);
    expect(await resolveCurrentUserIds()).toBeNull();
    expect(h.fake.writes).toEqual([]);
  });

  it("no cookie and no session → null, and no user is created", async () => {
    expect(await resolveCurrentUserIds()).toBeNull();
    expect(await resolveCurrentUserIds("auth-ghost")).toBeNull();
    expect(h.fake.writes).toEqual([]);
  });
});
