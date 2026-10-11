import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { FakeSupabase as FakeSupabaseT } from "../mocks/fake-supabase";

type AuthUser = { id: string; email: string };

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabaseT,
  cookies: new Map<string, string>(),
  authUser: null as AuthUser | null,
  signOut: vi.fn(),
  requireConsent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined),
    getAll: () => [...h.cookies].map(([name, value]) => ({ name, value })),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => h.fake.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.authUser }, error: null }),
      signOut: h.signOut,
    },
  }),
}));
vi.mock("@/lib/consent", () => ({ requireConsent: h.requireConsent, NoConsentError: class extends Error {} }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.captureException, captureMessage: vi.fn() }));

import { DELETE } from "@/app/api/me/route";
import { DELETE_CONFIRMATION } from "@/lib/privacy/delete";
import { USER_DATA_TABLES } from "@/lib/privacy/registry";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { makeFake, seedUser, ownedCounts, BUCKET, type SeededUser } from "./helpers/privacy-seed";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const TABLES = Object.keys(USER_DATA_TABLES);

function deleteRequest(body: unknown = { confirmation: DELETE_CONFIRMATION }, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/me", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

function signIn(u: SeededUser) {
  h.authUser = { id: u.authId!, email: `${u.authId}@example.com` };
}

function zeroCounts(): Record<string, number> {
  return Object.fromEntries(TABLES.map((t) => [t, 0]));
}

function stagesCaptured(): string[] {
  return h.captureException.mock.calls.map((c) => (c[1] as { tags: { stage: string } }).tags.stage);
}

let A: SeededUser;
let B: SeededUser;
let bBefore: Record<string, number>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.fake = makeFake();
  h.cookies.clear();
  h.authUser = null;
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.requireConsent.mockReset();
  h.captureException.mockReset();
  delete process.env.DATA_RIGHTS_ENABLED;
  A = seedUser(h.fake, { authId: "auth-a" });
  B = seedUser(h.fake, { anonToken: "tok-b" });
  bBefore = ownedCounts(h.fake, B.userId);
});

afterEach(() => {
  vi.useRealTimers();
});

function expectBUntouched() {
  expect(ownedCounts(h.fake, B.userId)).toEqual(bBefore);
  for (const p of B.objectPaths) expect(h.fake.objectPaths(BUCKET)).toContain(p);
}

function expectAGone() {
  expect(ownedCounts(h.fake, A.userId)).toEqual(zeroCounts());
  expect(h.fake.objectPaths(BUCKET).filter((p) => p.startsWith(`${A.userId}/`))).toEqual([]);
}

describe("DELETE /api/me — request validation", () => {
  it.each([[{}], [{ confirmation: "yes" }], [{ confirmation: "delete_my_account" }]])(
    "wrong confirmation %j → 400 and nothing deleted",
    async (body) => {
      signIn(A);
      const res = await DELETE(deleteRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "confirmation_required" });
      expect(h.fake.writes).toEqual([]);
      expect(h.fake.callsOf("storage.remove")).toEqual([]);
    },
  );

  it("cross-origin request → 403", async () => {
    signIn(A);
    const res = await DELETE(deleteRequest(undefined, "https://evil.example"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect(ownedCounts(h.fake, A.userId).users).toBe(1);
  });

  it("no credential at all → 401", async () => {
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_identity" });
    expect(h.fake.writes).toEqual([]);
  });

  it("returns 503 when the DATA_RIGHTS_ENABLED kill switch is off", async () => {
    process.env.DATA_RIGHTS_ENABLED = "false";
    signIn(A);
    expect((await DELETE(deleteRequest())).status).toBe(503);
    expect(ownedCounts(h.fake, A.userId).users).toBe(1);
  });
});

describe("DELETE /api/me — happy paths", () => {
  it("authed A: all rows, objects and the auth user are gone; B is untouched", async () => {
    signIn(A);
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expectAGone();
    expectBUntouched();
    expect(h.fake.callsOf("auth.admin.deleteUser")).toEqual([["auth-a"]]);
    expect(h.fake.authUsers.has("auth-a")).toBe(false);

    const expectedCounts = Object.fromEntries(TABLES.map((t) => [t, A.rows[t].length]));
    expect(body).toEqual({
      deleted: true,
      report: { tables: expectedCounts, storage_objects: 2, auth_user: "deleted" },
    });
    expect(res.headers.get("set-cookie")).toMatch(/co_anon=;/);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("deletes both the conversation-linked and the orphan career_profile rows", async () => {
    signIn(A);
    expect(h.fake.rows("career_profile").filter((r) => r.user_id === A.userId)).toHaveLength(2);
    await DELETE(deleteRequest());
    expect(h.fake.rows("career_profile").filter((r) => r.user_id === A.userId)).toEqual([]);
  });

  it("anonymous B: rows and objects are gone, no auth user is deleted, co_anon is cleared", async () => {
    h.cookies.set("co_anon", "tok-b");
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).report.auth_user).toBe("n/a");
    expect(ownedCounts(h.fake, B.userId)).toEqual(zeroCounts());
    expect(h.fake.callsOf("auth.admin.deleteUser")).toEqual([]);
    expect(res.headers.get("set-cookie")).toMatch(/co_anon=;/);
    expect(ownedCounts(h.fake, A.userId).users).toBe(1);
  });

  it("deletes the linked anonymous footprint too (stale co_anon on the same browser)", async () => {
    const C = seedUser(h.fake, { anonToken: "tok-c" });
    signIn(A);
    h.cookies.set("co_anon", "tok-c");
    expect((await DELETE(deleteRequest())).status).toBe(200);
    expectAGone();
    expect(ownedCounts(h.fake, C.userId)).toEqual(zeroCounts());
    expect(h.fake.objectPaths(BUCKET).filter((p) => p.startsWith(`${C.userId}/`))).toEqual([]);
    expectBUntouched();
  });

  it("is idempotent: a replay with the same session → 200 with zero counts, auth user 'absent'", async () => {
    signIn(A);
    await DELETE(deleteRequest());
    const again = await DELETE(deleteRequest());
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      deleted: true,
      report: { tables: zeroCounts(), storage_objects: 0, auth_user: "absent" },
    });
  });

  it("is idempotent for a replayed co_anon whose session is already gone", async () => {
    h.cookies.set("co_anon", "tok-b");
    await DELETE(deleteRequest());
    const again = await DELETE(deleteRequest());
    expect(again.status).toBe(200);
    expect((await again.json()).report).toEqual({ tables: zeroCounts(), storage_objects: 0, auth_user: "n/a" });
  });

  it("signing in again afterwards gives a fresh, empty account", async () => {
    signIn(A);
    await DELETE(deleteRequest());
    h.authUser = null;
    const freshId = await getOrCreateAnonymousUserId("auth-a-again");
    expect(freshId).not.toBe(A.userId);
    const counts = ownedCounts(h.fake, freshId);
    expect(counts.users).toBe(1);
    expect({ ...counts, users: 0 }).toEqual(zeroCounts());
  });

  it("does not require consent", async () => {
    for (const c of A.rows.consents) c.revoked_at = "2026-09-01T00:00:00.000Z";
    signIn(A);
    expect((await DELETE(deleteRequest())).status).toBe(200);
    expect(h.requireConsent).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me — partial failures and retries", () => {
  it("storage failure → 500 stage storage, DB untouched, retry succeeds", async () => {
    signIn(A);
    h.fake.failNext("storage.remove");
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "deletion_incomplete", stage: "storage", retryable: true });
    expect(ownedCounts(h.fake, A.userId).messages).toBe(3);
    expect(h.fake.callsOf("rpc:delete_user_data")).toEqual([]);
    expect(stagesCaptured()).toEqual(["storage"]);

    expect((await DELETE(deleteRequest())).status).toBe(200);
    expectAGone();
    expectBUntouched();
  });

  it("DB failure → 500 stage db, rows intact (rolled back), retry succeeds", async () => {
    signIn(A);
    h.fake.failNext("rpc:delete_user_data");
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "deletion_incomplete", stage: "db", retryable: true });
    expect(ownedCounts(h.fake, A.userId)).toEqual(Object.fromEntries(TABLES.map((t) => [t, A.rows[t].length])));
    expect(stagesCaptured()).toEqual(["db"]);
    expect(h.signOut).not.toHaveBeenCalled();

    expect((await DELETE(deleteRequest())).status).toBe(200);
    expectAGone();
  });

  it("auth failure → 500 stage auth, public data gone, session kept; retry deletes the auth user", async () => {
    signIn(A);
    h.fake.failNext("auth.admin.deleteUser");
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "deletion_incomplete", stage: "auth", retryable: true });
    expectAGone();
    expect(h.fake.authUsers.has("auth-a")).toBe(true);
    expect(stagesCaptured()).toEqual(["auth"]);
    // The session must survive so the user can retry.
    expect(h.signOut).not.toHaveBeenCalled();

    const retry = await DELETE(deleteRequest());
    expect(retry.status).toBe(200);
    expect((await retry.json()).report.auth_user).toBe("deleted");
    expect(h.fake.callsOf("auth.admin.deleteUser")).toEqual([["auth-a"], ["auth-a"]]);
    expect(h.fake.authUsers.has("auth-a")).toBe(false);
  });

  it("the post-DB sweep removes a CV uploaded mid-delete", async () => {
    signIn(A);
    const late = `${A.userId}/late.pdf`;
    h.fake.hooks.beforeRpc = () => h.fake.putObject(BUCKET, late);
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);
    expect(h.fake.objectPaths(BUCKET)).not.toContain(late);
    expect((await res.json()).report.storage_objects).toBe(3);
  });

  it("a sweep failure still returns 200, with a Sentry warning", async () => {
    signIn(A);
    h.fake.hooks.beforeRpc = () => h.fake.putObject(BUCKET, `${A.userId}/late.pdf`);
    h.fake.failNext("storage.remove", 1);
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);
    expect(stagesCaptured()).toEqual(["storage_sweep"]);
    expect(h.captureException.mock.calls[0][1]).toMatchObject({ level: "warning" });
  });
});

describe("DELETE /api/me — lock", () => {
  it("a deletion already in progress → 409, nothing deleted", async () => {
    signIn(A);
    h.fake.rows("users").find((r) => r.id === A.userId)!.deletion_requested_at = new Date(NOW.getTime() - 30_000).toISOString();
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "deletion_in_progress" });
    expect(ownedCounts(h.fake, A.userId).messages).toBe(3);
    expect(h.fake.callsOf("storage.remove")).toEqual([]);
  });

  it("a stale lock older than 2 minutes is claimable", async () => {
    signIn(A);
    h.fake.rows("users").find((r) => r.id === A.userId)!.deletion_requested_at = new Date(NOW.getTime() - 3 * 60_000).toISOString();
    expect((await DELETE(deleteRequest())).status).toBe(200);
    expectAGone();
  });

  it("two concurrent requests → one 200, one 409", async () => {
    signIn(A);
    const statuses = (await Promise.all([DELETE(deleteRequest()), DELETE(deleteRequest())])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 409]);
    expectAGone();
  });
});
