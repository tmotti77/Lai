import { describe, it, expect, vi, beforeEach } from "vitest";
import { config } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types.gen";

// Load .env.local with override so real credentials replace stubs set by
// tests/setup.ts. Must happen before any call to createServiceClient() since
// lib/env.ts captures process.env at module-evaluation time.
config({ path: path.resolve(__dirname, "../../.env.local"), override: true });

const HAS_REAL_DB =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith("stub");

// Build a Supabase client directly from the freshly-loaded env vars so we
// bypass the lib/env.ts singleton (which may have been initialised with stubs).
function makeClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Mock createServiceClient to use our real-env client
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () =>
    createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    ),
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  npsBucket: (s: number) => (s <= 6 ? "detractor" : s <= 8 ? "passive" : "promoter"),
  questionCountBucket: vi.fn(),
  skillCountBucket: vi.fn(),
}));
vi.mock("@/lib/consent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consent")>("@/lib/consent");
  return { ...actual, requireConsent: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/anonymous", () => ({
  getOrCreateAnonymousUserId: vi.fn(),
}));

import { POST } from "@/app/api/feedback/route";
import { track } from "@/lib/analytics";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";

async function makeReq(body: unknown): Promise<Request> {
  return new Request("http://test/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setupTestUser(): Promise<{ userId: string; messageId: string; sessionId: string; recId: string }> {
  const supabase = makeClient();
  const { data: u, error: uErr } = await supabase.from("users").insert({ is_anonymous: true }).select("id").single();
  if (!u) throw new Error(`setupTestUser: insert users failed: ${JSON.stringify(uErr)}`);
  const userId = u.id;
  const { data: c, error: cErr } = await supabase.from("conversations").insert({ user_id: userId, stage: "onboarding" }).select("id").single();
  if (!c) throw new Error(`setupTestUser: insert conversations failed: ${JSON.stringify(cErr)}`);
  const { data: m, error: mErr } = await supabase.from("messages").insert({ conversation_id: c.id, role: "assistant", content: "hi" }).select("id").single();
  if (!m) throw new Error(`setupTestUser: insert messages failed: ${JSON.stringify(mErr)}`);
  const { data: s, error: sErr } = await supabase.from("interview_sessions").insert({ user_id: userId, persona: "hr", target_role_he: "test" }).select("id").single();
  if (!s) throw new Error(`setupTestUser: insert interview_sessions failed: ${JSON.stringify(sErr)}`);
  const { data: r, error: rErr } = await supabase.from("recommendations").insert({ user_id: userId, profile_hash: "test", rankings: [], paths: {}, prose: {} }).select("id").single();
  if (!r) throw new Error(`setupTestUser: insert recommendations failed: ${JSON.stringify(rErr)}`);
  return { userId, messageId: m.id, sessionId: s.id, recId: r.id };
}

async function cleanup(userId: string) {
  await makeClient().from("users").delete().eq("id", userId);
}

beforeEach(() => vi.clearAllMocks());

describe.skipIf(!HAS_REAL_DB)(
  "POST /api/feedback — thumb path (integration, requires real Supabase)",
  () => {
    it("identical thumb resubmit is a no-op (no DB write, no event)", async () => {
      const { userId, sessionId } = await setupTestUser();
      try {
        (getOrCreateAnonymousUserId as ReturnType<typeof vi.fn>).mockResolvedValue(userId);
        await POST(await makeReq({
          kind: "thumb", surface: "interview", target_type: "interview_session",
          target_id: sessionId, thumbs_value: 1,
        }) as never);
        (track as ReturnType<typeof vi.fn>).mockClear();
        const res2 = await POST(await makeReq({
          kind: "thumb", surface: "interview", target_type: "interview_session",
          target_id: sessionId, thumbs_value: 1,
        }) as never);
        const body = await res2.json();
        expect(body.unchanged).toBe(true);
        expect(track).not.toHaveBeenCalled();
      } finally {
        await cleanup(userId);
      }
    });

    it("flip thumb up → down does UPDATE (still one row, new value)", async () => {
      const { userId, sessionId } = await setupTestUser();
      try {
        (getOrCreateAnonymousUserId as ReturnType<typeof vi.fn>).mockResolvedValue(userId);
        await POST(await makeReq({
          kind: "thumb", surface: "interview", target_type: "interview_session",
          target_id: sessionId, thumbs_value: 1,
        }) as never);
        await POST(await makeReq({
          kind: "thumb", surface: "interview", target_type: "interview_session",
          target_id: sessionId, thumbs_value: -1,
        }) as never);
        const supabase = makeClient();
        const { count, data } = await supabase
          .from("feedback")
          .select("*", { count: "exact" })
          .eq("target_id", sessionId);
        expect(count).toBe(1);
        expect(data![0].thumbs_value).toBe(-1);
      } finally {
        await cleanup(userId);
      }
    });

    it("un-vote (null) DELETEs the row", async () => {
      const { userId, sessionId } = await setupTestUser();
      try {
        (getOrCreateAnonymousUserId as ReturnType<typeof vi.fn>).mockResolvedValue(userId);
        await POST(await makeReq({
          kind: "thumb", surface: "interview", target_type: "interview_session",
          target_id: sessionId, thumbs_value: 1,
        }) as never);
        await POST(await makeReq({
          kind: "thumb", surface: "interview", target_type: "interview_session",
          target_id: sessionId, thumbs_value: null,
        }) as never);
        const supabase = makeClient();
        const { count } = await supabase.from("feedback").select("*", { count: "exact" }).eq("target_id", sessionId);
        expect(count).toBe(0);
      } finally {
        await cleanup(userId);
      }
    });

    it("target_not_found for foreign interview session", async () => {
      const { userId } = await setupTestUser();
      try {
        (getOrCreateAnonymousUserId as ReturnType<typeof vi.fn>).mockResolvedValue(userId);
        const res = await POST(await makeReq({
          kind: "thumb", surface: "interview", target_type: "interview_session",
          target_id: crypto.randomUUID(),
          thumbs_value: 1,
        }) as never);
        expect(res.status).toBe(404);
      } finally {
        await cleanup(userId);
      }
    });
  },
);
