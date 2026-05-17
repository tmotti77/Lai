import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers so route imports that call cookies() don't throw.
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}));

// Mock Supabase server client — routes call createClient() to resolve the authed user.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));

// Mock anonymous user resolution.
vi.mock("@/lib/anonymous", () => ({
  getOrCreateAnonymousUserId: vi.fn(async () => "test-user-id"),
}));

// Mock requireConsent to always throw NoConsentError.
// Use importActual so NoConsentError's class identity is preserved.
vi.mock("@/lib/consent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consent")>("@/lib/consent");
  return {
    ...actual,
    requireConsent: vi.fn(async () => {
      throw new actual.NoConsentError(["processing"]);
    }),
  };
});

beforeEach(() => vi.clearAllMocks());

function makeJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// cv/upload and cv/confirm are multipart-only — verified by file diff, not here.
const ROUTES_AND_BODIES = [
  {
    path: "@/app/api/chat/route",
    body: { messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] },
  },
  {
    path: "@/app/api/recommendations/route",
    body: {},
  },
  {
    path: "@/app/api/plan/generate/route",
    body: { recommendationId: "00000000-0000-0000-0000-000000000000" },
  },
  {
    path: "@/app/api/interview/route",
    body: { action: "start", persona: "hr", target_role_he: "מהנדס/ת" },
  },
  {
    path: "@/app/api/interview/wrap/route",
    body: { sessionId: "00000000-0000-0000-0000-000000000000" },
  },
] as const;

describe("consent enforcement on gated routes", () => {
  for (const { path, body } of ROUTES_AND_BODIES) {
    it(`${path} returns 403 when consent is missing`, async () => {
      const mod = await import(path);
      const handler = mod.POST as (req: Request) => Promise<Response>;
      const req = makeJsonRequest(body);
      const res = await handler(req);
      expect(res.status).toBe(403);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe("no_consent");
    });
  }
});
