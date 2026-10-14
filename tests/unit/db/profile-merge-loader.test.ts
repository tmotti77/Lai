import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for loadMergedProfile (lib/db/profile.ts).
 *
 * The loader reads ALL of a user's career_profile rows (paginated, since
 * PostgREST caps unlimited selects at max_rows=1000 regardless of .limit()),
 * plus the user's latest conversation id and formal assessments, then hands
 * the rows to the pure lib/matching/profile-rows.ts merge function.
 */

vi.mock("server-only", () => ({}));

const PAGE_SIZE = 1000;

type Call = { method: string; args: unknown[] };

type MockRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  updated_at: string;
  data: unknown;
};

const state: {
  conversations: { data: Array<{ id: string }> | null; error: { message: string } | null };
  profilePages: Array<{ data: MockRow[] | null; error: { message: string } | null }>;
  conversationsCalls: Call[][];
  profileCalls: Call[][];
} = {
  conversations: { data: [], error: null },
  profilePages: [],
  conversationsCalls: [],
  profileCalls: [],
};

function makeChain(onTerminal: (calls: Call[]) => Promise<{ data: unknown; error: unknown }>) {
  const calls: Call[] = [];
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "order", "range", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      if (method === "range" || method === "limit") {
        return onTerminal([...calls]);
      }
      return chain;
    };
  }
  return chain;
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "conversations") {
        return makeChain(async (calls) => {
          state.conversationsCalls.push(calls);
          return state.conversations;
        });
      }
      if (table === "career_profile") {
        return makeChain(async (calls) => {
          state.profileCalls.push(calls);
          const page = state.profilePages.shift();
          return page ?? { data: [], error: null };
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

vi.mock("@/lib/db/assessments", () => ({
  getLatestByType: vi.fn(),
}));

import { loadMergedProfile } from "@/lib/db/profile";
import { getLatestByType } from "@/lib/db/assessments";
import { buildMatchingProfile } from "@/lib/matching/profile";
import { profileHash } from "@/lib/matching/hash";

const FORMAL_EMPTY = { riasec: null, big5: null, values: null, constraints: null };

function row(partial: Partial<MockRow> & { id: string }): MockRow {
  return {
    user_id: "user-1",
    conversation_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    data: {},
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.conversations = { data: [], error: null };
  state.profilePages = [];
  state.conversationsCalls = [];
  state.profileCalls = [];
  (getLatestByType as ReturnType<typeof vi.fn>).mockResolvedValue(FORMAL_EMPTY);
});

describe("loadMergedProfile: pagination", () => {
  it("reads every page — a row only present on the second page survives the merge", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
      row({ id: `r-${String(i).padStart(4, "0")}` }),
    );
    const page2 = [
      row({ id: "r-1000", data: { skills: [{ id: "last-page-skill", name_he: "אחרון" }] } }),
    ];
    state.profilePages = [
      { data: page1, error: null },
      { data: page2, error: null },
    ];

    const result = await loadMergedProfile("user-1");
    const skillIds = (result as { data?: { skills?: Array<{ id?: string }> } }).data?.skills?.map(
      (s) => s.id,
    );
    expect(skillIds).toContain("last-page-skill");
    expect(state.profileCalls.length).toBe(2);
  });

  it("orders by id ascending and advances the range monotonically across pages", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => row({ id: `r-${i}` }));
    const page2 = [row({ id: "r-last" })];
    state.profilePages = [
      { data: page1, error: null },
      { data: page2, error: null },
    ];

    await loadMergedProfile("user-1");

    expect(state.profileCalls.length).toBe(2);
    for (const calls of state.profileCalls) {
      const orderCall = calls.find((c) => c.method === "order");
      expect(orderCall?.args).toEqual(["id", { ascending: true }]);
    }
    const ranges = state.profileCalls.map(
      (calls) => calls.find((c) => c.method === "range")?.args,
    );
    expect(ranges[0]).toEqual([0, PAGE_SIZE - 1]);
    expect(ranges[1]).toEqual([PAGE_SIZE, 2 * PAGE_SIZE - 1]);
  });

  it("scopes every career_profile page and the conversations lookup to the requested user", async () => {
    state.profilePages = [{ data: [row({ id: "r-1" })], error: null }];
    state.conversations = { data: [], error: null };

    await loadMergedProfile("user-42");

    expect(state.conversationsCalls.length).toBeGreaterThan(0);
    for (const calls of state.conversationsCalls) {
      const eqCall = calls.find((c) => c.method === "eq");
      expect(eqCall?.args).toEqual(["user_id", "user-42"]);
    }
    for (const calls of state.profileCalls) {
      const eqCall = calls.find((c) => c.method === "eq");
      expect(eqCall?.args).toEqual(["user_id", "user-42"]);
    }
  });

  it("rejects without merging a partial result when a later page errors", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => row({ id: `r-${i}` }));
    state.profilePages = [
      { data: page1, error: null },
      { data: null, error: { message: "boom" } },
    ];

    await expect(loadMergedProfile("user-1")).rejects.toThrow();
  });

  it("throws a clear error instead of looping forever past PROFILE_PAGE_CAP full pages", async () => {
    const PROFILE_PAGE_CAP = 10;
    // Every page comes back full-sized, so pagination would never stop on
    // its own — this pins the cap as the thing that breaks the loop.
    state.profilePages = Array.from({ length: PROFILE_PAGE_CAP + 1 }, (_, p) =>
      ({
        data: Array.from({ length: PAGE_SIZE }, (_, i) => row({ id: `r-${p}-${i}` })),
        error: null,
      }),
    );

    await expect(loadMergedProfile("user-1")).rejects.toThrow(/PROFILE_PAGE_CAP/);
    expect(state.profileCalls.length).toBe(PROFILE_PAGE_CAP);
  });
});

describe("loadMergedProfile: merge end to end", () => {
  it("merges an orphan row's CV skills with a conversation row's chat fields", async () => {
    state.conversations = { data: [{ id: "conv-1" }], error: null };
    const conversationRow = row({
      id: "row-conv",
      conversation_id: "conv-1",
      updated_at: "2026-02-01T00:00:00.000Z",
      data: { values: ["autonomy"], constraints: { time_per_week_hours: 10 }, skills: [] },
    });
    const orphanRow = row({
      id: "row-orphan",
      conversation_id: null,
      updated_at: "2026-01-01T00:00:00.000Z",
      data: { skills: [{ id: "data-analysis", name_he: "ניתוח נתונים", source: "cv" }] },
    });
    state.profilePages = [{ data: [conversationRow, orphanRow], error: null }];

    const merged = await loadMergedProfile("user-1");
    const profile = buildMatchingProfile(merged as Parameters<typeof buildMatchingProfile>[0]);

    expect(profile.skills?.map((s) => s.id)).toContain("data-analysis");
    expect(profile.values?.topThree).toContain("autonomy");
    expect(profile.constraints).toMatchObject({ time_per_week_hours: 10 });
  });

  it("returns { formal } with no rows, and buildMatchingProfile yields all-null dimensions", async () => {
    state.conversations = { data: [], error: null };
    state.profilePages = [{ data: [], error: null }];

    const merged = await loadMergedProfile("user-1");
    expect(merged).toEqual({ formal: FORMAL_EMPTY });

    const profile = buildMatchingProfile(merged as Parameters<typeof buildMatchingProfile>[0]);
    expect(profile).toEqual({
      interests: null,
      skills: null,
      values: null,
      big5: null,
      constraints: null,
    });
  });

  it("keeps a single row's hash stable whether or not it's conversation-linked", async () => {
    const singleRowLinked = row({
      id: "row-1",
      conversation_id: "conv-1",
      data: { skills: [{ label_he: "a" }, { label_he: "b" }] },
    });
    state.conversations = { data: [{ id: "conv-1" }], error: null };
    state.profilePages = [{ data: [singleRowLinked], error: null }];

    const merged = await loadMergedProfile("user-1");
    const got = buildMatchingProfile(merged as Parameters<typeof buildMatchingProfile>[0]);
    const expected = buildMatchingProfile({
      ...singleRowLinked,
      formal: FORMAL_EMPTY,
    } as unknown as Parameters<typeof buildMatchingProfile>[0]);
    expect(profileHash(got, 1)).toBe(profileHash(expected, 1));
  });

  it("keeps a single orphan row's hash stable when there is no conversation at all", async () => {
    const singleOrphan = row({
      id: "row-1",
      conversation_id: null,
      data: { skills: [{ label_he: "a" }, { label_he: "b" }] },
    });
    state.conversations = { data: [], error: null };
    state.profilePages = [{ data: [singleOrphan], error: null }];

    const merged = await loadMergedProfile("user-1");
    const got = buildMatchingProfile(merged as Parameters<typeof buildMatchingProfile>[0]);
    const expected = buildMatchingProfile({
      ...singleOrphan,
      formal: FORMAL_EMPTY,
    } as unknown as Parameters<typeof buildMatchingProfile>[0]);
    expect(profileHash(got, 1)).toBe(profileHash(expected, 1));
  });
});

describe("loadMergedProfile: formal assessments", () => {
  it("passes formal assessments through", async () => {
    const formal = {
      riasec: { scores: { R: 1, I: 1, A: 1, S: 1, E: 1, C: 1 } },
      big5: null,
      values: null,
      constraints: null,
    };
    (getLatestByType as ReturnType<typeof vi.fn>).mockResolvedValue(formal);
    state.conversations = { data: [], error: null };
    state.profilePages = [{ data: [], error: null }];

    const merged = await loadMergedProfile("user-1");
    expect((merged as { formal?: unknown }).formal).toEqual(formal);
  });

  it("swallows a getLatestByType rejection and sets formal: null", async () => {
    (getLatestByType as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
    state.conversations = { data: [], error: null };
    state.profilePages = [{ data: [], error: null }];

    const merged = await loadMergedProfile("user-1");
    expect((merged as { formal?: unknown }).formal).toBeNull();
  });
});

describe("loadMergedProfile: read failures", () => {
  it("rejects when the conversations lookup errors", async () => {
    state.conversations = { data: null, error: { message: "conversations down" } };
    state.profilePages = [{ data: [], error: null }];

    await expect(loadMergedProfile("user-1")).rejects.toThrow();
  });

  it("rejects when a career_profile page errors", async () => {
    state.conversations = { data: [], error: null };
    state.profilePages = [{ data: null, error: { message: "career_profile down" } }];

    await expect(loadMergedProfile("user-1")).rejects.toThrow();
  });
});
