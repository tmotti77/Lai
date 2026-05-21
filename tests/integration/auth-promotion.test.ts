import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chain: each .from(table) returns a stub the test wires per scenario.
// The mock is built by composition since the supabase-js fluent API uses
// many .eq().select().limit().maybeSingle() chains.

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

// Captured mock state per test
type Capture = {
  usersSelectByAuthId: () => Promise<{ data: { id: string } | null }>;
  anonSessionByToken?: () => Promise<{ data: { user_id: string } | null }>;
  promoteUpdate?: () => Promise<{ data: { id: string } | null }>;
  insertAuthedUser?: () => Promise<{ data: { id: string } | null }>;
  insertAnonUser?: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  sessionByCookie?: () => Promise<{ data: { user_id: string } | null }>;
  capturedAnonSessionDelete?: { token?: string };
  capturedSessionInsert?: { token: string; user_id: string };
  capturedPromoteUpdate?: { payload: unknown; whereId?: string };
};
let capture: Capture;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => buildClient(),
}));

function buildClient() {
  return {
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === "auth_id") {
                return { maybeSingle: () => capture.usersSelectByAuthId() };
              }
              return { maybeSingle: () => Promise.resolve({ data: null }) };
            },
          }),
          update: (payload: unknown) => ({
            eq: (col: string, val: string) => {
              if (col === "id") capture.capturedPromoteUpdate = { payload, whereId: val };
              return {
                eq: () => ({
                  select: () => ({
                    maybeSingle: () => (capture.promoteUpdate ? capture.promoteUpdate() : Promise.resolve({ data: null })),
                  }),
                }),
              };
            },
          }),
          insert: (payload: { auth_id?: string; is_anonymous?: boolean }) => ({
            select: () => ({
              single: () => {
                if (payload.is_anonymous === false && capture.insertAuthedUser) return capture.insertAuthedUser();
                if (payload.is_anonymous === true && capture.insertAnonUser) return capture.insertAnonUser();
                return Promise.resolve({ data: null, error: { message: "no mock" } });
              },
            }),
          }),
        };
      }
      if (table === "anonymous_sessions") {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({
                maybeSingle: () =>
                  capture.anonSessionByToken
                    ? capture.anonSessionByToken()
                    : capture.sessionByCookie
                    ? capture.sessionByCookie()
                    : Promise.resolve({ data: null }),
              }),
            }),
          }),
          insert: (payload: { token: string; user_id: string }) => {
            capture.capturedSessionInsert = payload;
            return Promise.resolve({ error: null });
          },
          delete: () => ({
            eq: (_col: string, token: string) => {
              capture.capturedAnonSessionDelete = { token };
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return { select: () => ({}), insert: () => ({}), update: () => ({}), delete: () => ({}) };
    },
  };
}

vi.mock("server-only", () => ({}));

import { getOrCreateAnonymousUserId } from "@/lib/anonymous";

beforeEach(() => {
  vi.clearAllMocks();
  capture = {
    usersSelectByAuthId: () => Promise.resolve({ data: null }),
  };
});

describe("getOrCreateAnonymousUserId — auth promotion", () => {
  it("returns existing authed user row when one already exists for this auth_id", async () => {
    capture.usersSelectByAuthId = () => Promise.resolve({ data: { id: "existing-authed-uid" } });
    const id = await getOrCreateAnonymousUserId("auth-123");
    expect(id).toBe("existing-authed-uid");
    expect(capture.capturedPromoteUpdate).toBeUndefined();
    expect(capture.insertAuthedUser).toBeUndefined();
  });

  it("promotes anonymous user in-place on first sign-in when co_anon cookie maps to an active session", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "anon-token-abc" });
    capture.usersSelectByAuthId = () => Promise.resolve({ data: null });
    capture.anonSessionByToken = () => Promise.resolve({ data: { user_id: "anon-user-id" } });
    capture.promoteUpdate = () => Promise.resolve({ data: { id: "anon-user-id" } });

    const id = await getOrCreateAnonymousUserId("auth-new");

    expect(id).toBe("anon-user-id");
    expect(capture.capturedPromoteUpdate).toMatchObject({
      payload: { auth_id: "auth-new", is_anonymous: false },
      whereId: "anon-user-id",
    });
    // Anonymous session row is deleted post-promotion
    expect(capture.capturedAnonSessionDelete).toEqual({ token: "anon-token-abc" });
  });

  it("does NOT overwrite an already-promoted row (race / second sign-in)", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "anon-token-stale" });
    capture.usersSelectByAuthId = () => Promise.resolve({ data: null });
    capture.anonSessionByToken = () => Promise.resolve({ data: { user_id: "already-promoted-id" } });
    // UPDATE returns no rows because `.eq("is_anonymous", true)` filter doesn't match
    // (the row has is_anonymous=false already). Code path then falls through to INSERT.
    capture.promoteUpdate = () => Promise.resolve({ data: null });
    capture.insertAuthedUser = () => Promise.resolve({ data: { id: "fresh-authed-id" } });

    const id = await getOrCreateAnonymousUserId("auth-race");

    expect(id).toBe("fresh-authed-id");
    // The cleanup of the stale anon session is GATED on promotion success.
    // Since promoteUpdate returned no rows, the anonymous_sessions delete
    // should NOT run.
    expect(capture.capturedAnonSessionDelete).toBeUndefined();
  });

  it("creates fresh authed user when no co_anon cookie is present", async () => {
    cookieStore.get.mockReturnValueOnce(undefined);
    capture.usersSelectByAuthId = () => Promise.resolve({ data: null });
    capture.insertAuthedUser = () => Promise.resolve({ data: { id: "fresh-id" } });

    const id = await getOrCreateAnonymousUserId("auth-fresh");

    expect(id).toBe("fresh-id");
    expect(capture.capturedPromoteUpdate).toBeUndefined();
  });

  it("creates fresh authed user when co_anon cookie points to an expired session", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "expired-token" });
    capture.usersSelectByAuthId = () => Promise.resolve({ data: null });
    // Expired session: the .gt("expires_at", now()) filter excludes it
    capture.anonSessionByToken = () => Promise.resolve({ data: null });
    capture.insertAuthedUser = () => Promise.resolve({ data: { id: "fresh-after-expiry" } });

    const id = await getOrCreateAnonymousUserId("auth-after-expiry");

    expect(id).toBe("fresh-after-expiry");
    expect(capture.capturedPromoteUpdate).toBeUndefined();
  });

  it("returns existing anonymous user_id when cookie maps to active session (no auth)", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "active-anon-token" });
    capture.sessionByCookie = () => Promise.resolve({ data: { user_id: "anon-uid-xyz" } });

    const id = await getOrCreateAnonymousUserId(/* no auth */);

    expect(id).toBe("anon-uid-xyz");
    expect(capture.insertAnonUser).toBeUndefined();
  });

  it("creates fresh anonymous user when no auth and no cookie", async () => {
    cookieStore.get.mockReturnValueOnce(undefined);
    capture.insertAnonUser = () => Promise.resolve({ data: { id: "brand-new-anon" }, error: null });

    const id = await getOrCreateAnonymousUserId(/* no auth */);

    expect(id).toBe("brand-new-anon");
    expect(capture.capturedSessionInsert?.user_id).toBe("brand-new-anon");
    // A session token must have been generated and inserted
    expect(capture.capturedSessionInsert?.token.length).toBeGreaterThan(20);
  });
});
