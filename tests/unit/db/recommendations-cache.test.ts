import { describe, it, expect, vi, beforeEach } from "vitest";

// The cache logic in lib/db/recommendations.ts is the heart of the
// matching engine's performance — a cache miss = LLM call = real money +
// 5-15s latency. These tests pin two invariants:
//   1. Cached rows older than CACHE_TTL_MS (7 days) must be treated as misses
//   2. Cache key is (user_id, profile_hash) — different hash returns null

vi.mock("server-only", () => ({}));

const cacheData: { rows: Array<{ user_id: string; profile_hash: string; generated_at: string; data: unknown }> } = { rows: [] };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          eq: (_col2: string, val2: string) => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => {
                  const match = cacheData.rows
                    .filter((r) => r.user_id === val && r.profile_hash === val2)
                    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
                  if (!match) return Promise.resolve({ data: null, error: null });
                  return Promise.resolve({
                    data: {
                      id: "rec-id",
                      rankings: [],
                      paths: { safe: null, growth: null, wildcard: null },
                      prose: {},
                      generated_at: match.generated_at,
                    },
                    error: null,
                  });
                },
              }),
            }),
          }),
        }),
      }),
      insert: (payload: { user_id: string; profile_hash: string }) => {
        cacheData.rows.push({
          user_id: payload.user_id,
          profile_hash: payload.profile_hash,
          generated_at: new Date().toISOString(),
          data: {},
        });
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

import { getCached, saveRecommendation } from "@/lib/db/recommendations";

beforeEach(() => {
  cacheData.rows = [];
});

describe("recommendations cache (getCached)", () => {
  it("returns null when no row exists for (user, hash)", async () => {
    const result = await getCached("user-1", "hash-abc");
    expect(result).toBeNull();
  });

  it("returns the cached row when one exists with matching hash + fresh timestamp", async () => {
    await saveRecommendation({
      userId: "user-1",
      profileHash: "hash-abc",
      rankings: [],
      paths: { safe: null, growth: null, wildcard: null },
      prose: {},
    });
    const result = await getCached("user-1", "hash-abc");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("rec-id");
  });

  it("treats rows older than 7 days as cache misses (returns null)", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    cacheData.rows.push({
      user_id: "user-1",
      profile_hash: "hash-abc",
      generated_at: eightDaysAgo,
      data: {},
    });
    const result = await getCached("user-1", "hash-abc");
    expect(result).toBeNull();
  });

  it("returns null when user_id matches but hash differs", async () => {
    await saveRecommendation({
      userId: "user-1",
      profileHash: "hash-OLD",
      rankings: [],
      paths: { safe: null, growth: null, wildcard: null },
      prose: {},
    });
    // Same user, different profile_hash → cache miss (profile changed)
    const result = await getCached("user-1", "hash-NEW");
    expect(result).toBeNull();
  });

  it("returns null when hash matches but different user", async () => {
    await saveRecommendation({
      userId: "user-A",
      profileHash: "shared-hash",
      rankings: [],
      paths: { safe: null, growth: null, wildcard: null },
      prose: {},
    });
    const result = await getCached("user-B", "shared-hash");
    expect(result).toBeNull();
  });

  it("accepts rows exactly at the TTL boundary (6 days 23h ago = fresh)", async () => {
    const justUnderBoundary = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000 - 23 * 60 * 60 * 1000).toISOString();
    cacheData.rows.push({
      user_id: "user-1",
      profile_hash: "hash-abc",
      generated_at: justUnderBoundary,
      data: {},
    });
    const result = await getCached("user-1", "hash-abc");
    expect(result).not.toBeNull();
  });
});
