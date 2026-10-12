import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { FakeSupabase as FakeSupabaseT } from "../mocks/fake-supabase";

type AuthUser = { id: string; email: string };

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabaseT,
  cookies: new Map<string, string>(),
  authUser: null as AuthUser | null,
  authError: null as Error | null,
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
      getUser: async () => {
        if (h.authError?.name === "TypeError") throw h.authError;
        return { data: { user: h.authError ? null : h.authUser }, error: h.authError };
      },
      signOut: h.signOut,
    },
  }),
}));
vi.mock("@/lib/consent", () => ({ requireConsent: h.requireConsent, NoConsentError: class extends Error {} }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.captureException, captureMessage: vi.fn() }));

import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
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
  h.authError = null;
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
      complete: true,
      report: { tables: expectedCounts, storage_objects: 2, storage_cleanup: "complete", auth_user: "deleted" },
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
      complete: true,
      report: { tables: zeroCounts(), storage_objects: 0, storage_cleanup: "not_checked", auth_user: "absent" },
    });
  });

  it("is idempotent for a replayed co_anon whose session is already gone", async () => {
    h.cookies.set("co_anon", "tok-b");
    await DELETE(deleteRequest());
    const again = await DELETE(deleteRequest());
    expect(again.status).toBe(200);
    expect((await again.json()).report).toEqual({
      tables: zeroCounts(),
      storage_objects: 0,
      storage_cleanup: "not_checked",
      auth_user: "n/a",
    });
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

  it("a transient sweep failure is retried in-request and the late CV is removed", async () => {
    signIn(A);
    const late = `${A.userId}/late.pdf`;
    h.fake.hooks.beforeRpc = () => h.fake.putObject(BUCKET, late);
    h.fake.failNext("storage.remove", 1); // stage 1 succeeds, the first sweep attempt fails
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.complete).toBe(true);
    expect(body.report.storage_cleanup).toBe("complete");
    expect(h.fake.objectPaths(BUCKET)).not.toContain(late);
    expect(h.captureException).not.toHaveBeenCalled();
  });

  it("a persistent sweep failure is not reported as full success", async () => {
    signIn(A);
    const late = `${A.userId}/late.pdf`;
    h.fake.hooks.beforeRpc = () => h.fake.putObject(BUCKET, late);
    h.fake.failNext("storage.remove", 1);
    h.fake.failNext("storage.remove");
    h.fake.failNext("storage.remove");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await DELETE(deleteRequest());

    // Rows and the auth user are gone; a retry has nothing left to resolve, so the
    // honest answer is "deleted, but storage cleanup is incomplete", not a retryable 5xx.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ deleted: true, complete: false });
    expect(body.report.storage_cleanup).toBe("incomplete");
    expect(body.report.auth_user).toBe("deleted");
    expect(ownedCounts(h.fake, A.userId)).toEqual(zeroCounts());
    expect(h.fake.objectPaths(BUCKET).filter((p) => p.startsWith(`${A.userId}/`))).toEqual([late]);

    expect(stagesCaptured()).toEqual(["storage_sweep"]);
    expect(h.captureException.mock.calls[0][1]).toMatchObject({ level: "error", extra: { userId: A.userId } });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();

    // The client retry converges (200, zero counts) but can no longer see the folder, so
    // it says it did not check storage rather than claiming it is clean.
    const retry = await DELETE(deleteRequest());
    expect(retry.status).toBe(200);
    expect((await retry.json()).report.storage_cleanup).toBe("not_checked");
    expect(h.fake.objectPaths(BUCKET)).toContain(late);
  });
});

describe("DELETE /api/me — lock", () => {
  it("a deletion already in progress → 409, nothing deleted", async () => {
    signIn(A);
    h.fake.rows("users").find((r) => r.id === A.userId)!.deletion_requested_at = new Date(NOW.getTime() - 30_000).toISOString();
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(409);
    // The lock was taken 30 s ago and expires after 120 s.
    expect(res.headers.get("retry-after")).toBe("90");
    expect(await res.json()).toEqual({ error: "deletion_in_progress", retry_after_s: 90 });
    expect(ownedCounts(h.fake, A.userId).messages).toBe(3);
    expect(h.fake.callsOf("storage.remove")).toEqual([]);
  });

  it("Retry-After is at least 1 s, even for a lock about to expire", async () => {
    signIn(A);
    h.fake.rows("users").find((r) => r.id === A.userId)!.deletion_requested_at = new Date(NOW.getTime() - 119_500).toISOString();
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("1");
  });

  it("a stale lock older than 2 minutes is claimable", async () => {
    signIn(A);
    h.fake.rows("users").find((r) => r.id === A.userId)!.deletion_requested_at = new Date(NOW.getTime() - 3 * 60_000).toISOString();
    expect((await DELETE(deleteRequest())).status).toBe(200);
    expectAGone();
  });

  it("two concurrent requests → one 200, one 409", async () => {
    signIn(A);
    const responses = await Promise.all([DELETE(deleteRequest()), DELETE(deleteRequest())]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((r) => r.status === 409)!;
    expect(conflict.headers.get("retry-after")).toBe("120");
    expectAGone();
  });
});

describe("DELETE /api/me — auth service errors", () => {
  it.each([
    ["a retryable fetch error", () => new AuthRetryableFetchError("fetch failed", 0)],
    ["an auth 5xx", () => new AuthApiError("upstream down", 503, "unexpected_failure")],
    ["an auth 429", () => new AuthApiError("slow down", 429, "over_request_rate_limit")],
    ["a rejected API key (our config, not the caller)", () => new AuthApiError("Invalid API key", 401, undefined)],
    ["an auth 404 with no code", () => new AuthApiError("Not Found", 404, undefined)],
    ["an unknown auth error", () => new AuthUnknownError("bad json", new Error("x"))],
    ["a thrown error", () => new TypeError("network down")],
  ])("%s → 503 and nothing is deleted, even with an anon cookie", async (_label, makeError) => {
    const C = seedUser(h.fake, { anonToken: "tok-c" });
    const cBefore = ownedCounts(h.fake, C.userId);
    signIn(A);
    h.cookies.set("co_anon", "tok-c");
    h.authError = makeError();
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_unavailable", retryable: true });
    expect(ownedCounts(h.fake, A.userId)).toEqual(Object.fromEntries(TABLES.map((t) => [t, A.rows[t].length])));
    expect(ownedCounts(h.fake, C.userId)).toEqual(cBefore);
    expect(h.fake.callsOf("storage.remove")).toEqual([]);
    expect(h.fake.callsOf("auth.admin.deleteUser")).toEqual([]);
    expect(h.fake.authUsers.has("auth-a")).toBe(true);
    expect(stagesCaptured()).toEqual(["identity"]);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/co_anon=;/);
  });

  it("no session (AuthSessionMissingError) with a live co_anon → deletes the anonymous footprint", async () => {
    h.authError = new AuthSessionMissingError();
    h.cookies.set("co_anon", "tok-b");
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).report.auth_user).toBe("n/a");
    expect(ownedCounts(h.fake, B.userId)).toEqual(zeroCounts());
    expect(ownedCounts(h.fake, A.userId).users).toBe(1);
  });

  it.each(["bad_jwt", "session_expired", "session_not_found", "refresh_token_not_found"])(
    "a rejected session (%s) with a live co_anon → 401 session_expired, nothing deleted",
    async (code) => {
      h.authError = new AuthApiError("rejected", 403, code);
      h.cookies.set("co_anon", "tok-b");
      const res = await DELETE(deleteRequest());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "session_expired" });
      expect(ownedCounts(h.fake, B.userId)).toEqual(bBefore);
      expect(h.fake.callsOf("storage.remove")).toEqual([]);
    },
  );

  it("an auth user that no longer exists (user_not_found) counts as a credential: replay → 200", async () => {
    signIn(A);
    await DELETE(deleteRequest());
    h.authError = new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found");
    const again = await DELETE(deleteRequest());
    expect(again.status).toBe(200);
    expect((await again.json()).report.auth_user).toBe("n/a");
  });

  it("no session and no cookie → 401", async () => {
    h.authError = new AuthSessionMissingError();
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(401);
    expect(h.fake.writes).toEqual([]);
  });
});
