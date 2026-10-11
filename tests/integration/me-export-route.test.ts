import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FakeSupabase as FakeSupabaseT } from "../mocks/fake-supabase";

type AuthUser = { id: string; email: string; created_at: string; last_sign_in_at: string };

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabaseT,
  cookies: new Map<string, string>(),
  authUser: null as AuthUser | null,
  requireConsent: vi.fn(),
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
      signOut: vi.fn(async () => ({ error: null })),
    },
  }),
}));
vi.mock("@/lib/consent", () => ({ requireConsent: h.requireConsent, NoConsentError: class extends Error {} }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { GET } from "@/app/api/me/export/route";
import { USER_DATA_TABLES } from "@/lib/privacy/registry";
import { makeFake, seedUser, type SeededUser } from "./helpers/privacy-seed";

const NOW = new Date("2026-10-11T12:00:00.000Z");

function signIn(u: SeededUser) {
  h.authUser = { id: u.authId!, email: `${u.authId}@example.com`, created_at: "2026-01-01T00:00:00.000Z", last_sign_in_at: "2026-10-01T00:00:00.000Z" };
}

let A: SeededUser;
let B: SeededUser;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.fake = makeFake();
  h.cookies.clear();
  h.authUser = null;
  h.requireConsent.mockReset();
  delete process.env.DATA_RIGHTS_ENABLED;
  A = seedUser(h.fake, { authId: "auth-a", messages: 1500 });
  B = seedUser(h.fake, { anonToken: "tok-b" });
  h.fake.writes = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/me/export", () => {
  it("authed A gets exactly A's rows in every table, and nothing of B's", async () => {
    signIn(A);
    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);

    expect(body.format_version).toBe(1);
    expect(body.account).toMatchObject({ user_id: A.userId, is_anonymous: false, auth: { email: "auth-a@example.com" } });
    expect(Object.keys(body.tables).sort()).toEqual(Object.keys(USER_DATA_TABLES).sort());
    for (const table of Object.keys(USER_DATA_TABLES)) {
      expect(body.tables[table].length, table).toBe(A.rows[table].length);
    }
    for (const id of B.ownedIds) expect(text).not.toContain(id);
    expect(text).not.toContain(B.userId);
  });

  it("paginates past PostgREST's 1000-row cap (all 1,500 messages)", async () => {
    signIn(A);
    const body = await (await GET()).json();
    expect(body.tables.messages).toHaveLength(1500);
    expect(new Set(body.tables.messages.map((m: { id: string }) => m.id)).size).toBe(1500);
  });

  it("includes both the conversation-linked and the orphan career_profile rows", async () => {
    signIn(A);
    const body = await (await GET()).json();
    const convIds = body.tables.career_profile.map((p: { conversation_id: string | null }) => p.conversation_id);
    expect(convIds).toContain(null);
    expect(convIds).toContain(A.rows.conversations[0].id);
  });

  it("redacts anonymous_sessions.token but keeps the timestamps", async () => {
    signIn(A);
    const text = await (await GET()).text();
    const body = JSON.parse(text);
    expect(body.tables.anonymous_sessions[0]).toMatchObject({ token: "[redacted]", expires_at: expect.any(String) });
    expect(text).not.toContain(String(A.rows.anonymous_sessions[0].token));
  });

  it("lists storage objects with signed URLs, including orphans, and flags missing ones", async () => {
    signIn(A);
    const body = await (await GET()).json();
    const byPath = Object.fromEntries(body.storage.map((s: { path: string }) => [s.path, s]));
    expect(Object.keys(byPath).sort()).toEqual([...A.objectPaths, A.missingObjectPath].sort());
    for (const p of A.objectPaths) {
      expect(byPath[p]).toMatchObject({ bucket: "cv-uploads", available: true, signed_url: expect.stringContaining(p) });
    }
    expect(byPath[`${A.userId}/cv-present.pdf`].original_filename).toBe("my-cv.pdf");
    expect(byPath[A.missingObjectPath]).toMatchObject({ available: false, signed_url: null });
    // 15-minute expiry, with a download filename.
    const signCalls = h.fake.callsOf("storage.createSignedUrl");
    expect(signCalls.every((c) => c[2] === 900)).toBe(true);
    expect(signCalls.find((c) => c[1] === `${A.userId}/cv-present.pdf`)?.[3]).toEqual({ download: "my-cv.pdf" });
  });

  it("anonymous B exports via cookie and sees only B", async () => {
    h.cookies.set("co_anon", "tok-b");
    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.account).toMatchObject({ user_id: B.userId, is_anonymous: true, auth: null });
    expect(body.tables.messages).toHaveLength(3);
    for (const id of A.ownedIds) expect(text).not.toContain(id);
  });

  it("includes the linked anonymous footprint when the browser's co_anon maps to another unpromoted row", async () => {
    const C = seedUser(h.fake, { anonToken: "tok-c" });
    signIn(A);
    h.cookies.set("co_anon", "tok-c");
    const body = await (await GET()).json();
    expect(body.account.user_id).toBe(A.userId);
    expect(body.linked_anonymous.user_id).toBe(C.userId);
    expect(body.linked_anonymous.tables.conversations).toHaveLength(1);
    expect(body.linked_anonymous.storage).toHaveLength(3);
  });

  it("no identity → 401 and nothing is created", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_identity" });
    expect(h.fake.writes).toEqual([]);
  });

  it("rate limits to one export per 60 s per user", async () => {
    signIn(A);
    expect((await GET()).status).toBe(200);
    const limited = await GET();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    expect((await GET()).status).toBe(200);
  });

  it("sets download, no-store and nosniff headers", async () => {
    signIn(A);
    const res = await GET();
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="careeros-export-2026-10-11.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not require consent: a user who revoked consent can still export", async () => {
    for (const c of A.rows.consents) c.revoked_at = "2026-09-01T00:00:00.000Z";
    signIn(A);
    expect((await GET()).status).toBe(200);
    expect(h.requireConsent).not.toHaveBeenCalled();
  });

  it("returns 503 when the DATA_RIGHTS_ENABLED kill switch is off", async () => {
    process.env.DATA_RIGHTS_ENABLED = "false";
    signIn(A);
    expect((await GET()).status).toBe(503);
  });
});
