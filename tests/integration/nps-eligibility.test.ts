import { describe, it, expect } from "vitest";
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

// Build a Supabase client directly from the freshly-loaded env vars so we
// bypass the lib/env.ts singleton (which may have been initialised with stubs
// before this file loaded).
function makeClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function createTestUser(): Promise<string> {
  const { data, error } = await makeClient()
    .from("users")
    .insert({ is_anonymous: true })
    .select("id")
    .single();
  if (!data) throw new Error(`createTestUser failed: ${JSON.stringify(error)}`);
  return data.id;
}

async function cleanupTestUser(userId: string): Promise<void> {
  await makeClient().from("users").delete().eq("id", userId);
}

// Dynamic import so the helpers pick up the real env vars at call time.
async function getHelpers() {
  return await import("@/lib/db/nps");
}

describe.skipIf(!HAS_REAL_DB)(
  "markNpsEligibilityIfFirst (integration, requires real Supabase)",
  () => {
    it("first call sets eligibility + trigger", async () => {
      const { markNpsEligibilityIfFirst, getNpsEligibility } = await getHelpers();
      const userId = await createTestUser();
      try {
        await markNpsEligibilityIfFirst(userId, "pdf_download");
        const elig = await getNpsEligibility(userId);
        expect(elig.show).toBe(true);
        expect(elig.trigger).toBe("pdf_download");
      } finally {
        await cleanupTestUser(userId);
      }
    });

    it("second call is a no-op (first trigger wins)", async () => {
      const { markNpsEligibilityIfFirst, getNpsEligibility } = await getHelpers();
      const userId = await createTestUser();
      try {
        await markNpsEligibilityIfFirst(userId, "pdf_download");
        await markNpsEligibilityIfFirst(userId, "interview_completed");
        const elig = await getNpsEligibility(userId);
        expect(elig.trigger).toBe("pdf_download");
      } finally {
        await cleanupTestUser(userId);
      }
    });

    it("concurrent calls — exactly one wins", async () => {
      const { markNpsEligibilityIfFirst, getNpsEligibility } = await getHelpers();
      const userId = await createTestUser();
      try {
        await Promise.all([
          markNpsEligibilityIfFirst(userId, "pdf_download"),
          markNpsEligibilityIfFirst(userId, "plan_generated"),
          markNpsEligibilityIfFirst(userId, "interview_completed"),
        ]);
        const elig = await getNpsEligibility(userId);
        expect(elig.show).toBe(true);
        expect(["pdf_download", "plan_generated", "interview_completed"]).toContain(elig.trigger);
      } finally {
        await cleanupTestUser(userId);
      }
    });

    it("getNpsEligibility returns show:false when never eligible", async () => {
      const { getNpsEligibility } = await getHelpers();
      const userId = await createTestUser();
      try {
        const elig = await getNpsEligibility(userId);
        expect(elig.show).toBe(false);
        expect(elig.trigger).toBe(null);
      } finally {
        await cleanupTestUser(userId);
      }
    });
  },
);
