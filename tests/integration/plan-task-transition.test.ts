import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "node:path";
import type { Database } from "@/lib/db/types.gen";

// Load .env.local with override so real credentials replace the stubs set by
// tests/setup.ts. Must happen before any call to createServiceClient() since
// lib/env.ts captures process.env at module-evaluation time.
config({ path: path.resolve(__dirname, "../../.env.local"), override: true });

// Real Supabase access is required; skip in CI / unit runs that use stub vars.
const HAS_REAL_DB =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith("stub");

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  npsBucket: (s: number) => (s <= 6 ? "detractor" : s <= 8 ? "passive" : "promoter"),
  questionCountBucket: vi.fn(),
  skillCountBucket: vi.fn(),
}));

// Dynamic import of track so we can spy on it after the mock is in place
let track: ReturnType<typeof vi.fn>;

function makeClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function setupOwnedTask(): Promise<{ userId: string; taskId: string }> {
  const s = makeClient();
  const { data: u } = await s.from("users").insert({ is_anonymous: true }).select("id").single();
  if (!u) throw new Error("failed to create test user");
  const { data: r } = await s
    .from("recommendations")
    .insert({ user_id: u.id, profile_hash: "test", rankings: [], paths: {}, prose: {} })
    .select("id")
    .single();
  if (!r) throw new Error("failed to create test recommendation");
  const { data: p } = await s
    .from("plans")
    .insert({ user_id: u.id, recommendation_id: r.id, archetype: "apply" })
    .select("id")
    .single();
  if (!p) throw new Error("failed to create test plan");
  const { data: t } = await s
    .from("plan_tasks")
    .insert({
      plan_id: p.id,
      day: 5,
      title_he: "test",
      description_he: "test",
      category: "action",
      estimated_minutes: 30,
      done: false,
    })
    .select("id")
    .single();
  if (!t) throw new Error("failed to create test task");
  return { userId: u.id, taskId: t.id };
}

async function cleanup(userId: string) {
  await makeClient().from("users").delete().eq("id", userId);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const analytics = await import("@/lib/analytics");
  track = analytics.track as ReturnType<typeof vi.fn>;
});

describe.skipIf(!HAS_REAL_DB)(
  "toggleTaskDone (integration, requires real Supabase)",
  () => {
    it("false→true emits plan_task_completed with category+week", async () => {
      const { toggleTaskDone } = await import("@/lib/db/plans");
      const { userId, taskId } = await setupOwnedTask();
      try {
        await toggleTaskDone(userId, taskId, true);
        expect(track).toHaveBeenCalledWith("plan_task_completed", {
          category: "action",
          week: 1,
        });
      } finally {
        await cleanup(userId);
      }
    });

    it("true→true is a no-op (no event)", async () => {
      const { toggleTaskDone } = await import("@/lib/db/plans");
      const { userId, taskId } = await setupOwnedTask();
      try {
        await toggleTaskDone(userId, taskId, true);
        track.mockClear();
        await toggleTaskDone(userId, taskId, true);
        expect(track).not.toHaveBeenCalled();
      } finally {
        await cleanup(userId);
      }
    });

    it("true→false un-toggles, no event", async () => {
      const { toggleTaskDone } = await import("@/lib/db/plans");
      const { userId, taskId } = await setupOwnedTask();
      try {
        await toggleTaskDone(userId, taskId, true);
        track.mockClear();
        await toggleTaskDone(userId, taskId, false);
        expect(track).not.toHaveBeenCalled();
      } finally {
        await cleanup(userId);
      }
    });

    it("cross-user mutation throws ForbiddenError", async () => {
      const { toggleTaskDone, ForbiddenError } = await import("@/lib/db/plans");
      const { taskId, userId } = await setupOwnedTask();
      const s = makeClient();
      const { data: otherUser } = await s
        .from("users")
        .insert({ is_anonymous: true })
        .select("id")
        .single();
      if (!otherUser) throw new Error("failed to create other test user");
      try {
        await expect(toggleTaskDone(otherUser.id, taskId, true)).rejects.toThrow(ForbiddenError);
      } finally {
        await cleanup(userId);
        await cleanup(otherUser.id);
      }
    });
  },
);
