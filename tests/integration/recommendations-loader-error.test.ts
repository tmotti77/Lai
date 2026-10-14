import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * loadMergedProfile throws on a read error (lib/db/profile.ts). This pins
 * the recommendations route's handling of that throw: a generic 500 body
 * (no leaked error message) and no downstream work (ranking, LLM prose,
 * or cache write) performed.
 */

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));

vi.mock("@/lib/anonymous", () => ({
  getOrCreateAnonymousUserId: vi.fn(async () => "test-user-id"),
}));

vi.mock("@/lib/consent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consent")>("@/lib/consent");
  return { ...actual, requireConsent: vi.fn(async () => {}) };
});

const loadMergedProfile = vi.fn();
vi.mock("@/lib/db/profile", () => ({ loadMergedProfile }));

vi.mock("@/lib/db/occupations", () => ({
  loadAllOccupations: vi.fn(async () => []),
  loadCatalogVersion: vi.fn(async () => 1),
}));

const getCached = vi.fn();
const saveRecommendation = vi.fn();
vi.mock("@/lib/db/recommendations", () => ({ getCached, saveRecommendation }));

const rankOccupations = vi.fn();
vi.mock("@/lib/matching/engine", () => ({ rankOccupations }));

vi.mock("@/lib/matching/paths", () => ({ pickPaths: vi.fn(() => ({ safe: null, growth: null, wildcard: null })) }));

const generateExplanations = vi.fn();
vi.mock("@/lib/ai/prompts/explanations", () => ({ generateExplanations }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  })),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(): Request {
  return new Request("http://localhost/api/recommendations", { method: "POST" });
}

describe("POST /api/recommendations: loader read failure", () => {
  it("returns a generic 500 and never ranks or calls the LLM when loadMergedProfile rejects", async () => {
    loadMergedProfile.mockRejectedValue(new Error("career_profile read failed: boom"));

    const { POST } = await import("@/app/api/recommendations/route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "recommendations_failed" });
    expect(json.message).toBeUndefined();

    expect(rankOccupations).not.toHaveBeenCalled();
    expect(generateExplanations).not.toHaveBeenCalled();
    expect(saveRecommendation).not.toHaveBeenCalled();
  });

  it("returns a generic 500 regardless of which internal read failed", async () => {
    loadMergedProfile.mockRejectedValue(new Error("conversations lookup failed: boom"));

    const { POST } = await import("@/app/api/recommendations/route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "recommendations_failed" });

    expect(rankOccupations).not.toHaveBeenCalled();
    expect(generateExplanations).not.toHaveBeenCalled();
    expect(saveRecommendation).not.toHaveBeenCalled();
  });
});
