/**
 * Write-path smoke test for the assessment submit flow.
 *
 * The happy-path submit (submit -> score -> persist) is intentionally skipped in
 * Vitest (tests/integration/assessment-submit.test.ts) because it needs a real
 * Next request scope + Supabase. This script closes that coverage gap against a
 * live deployment.
 *
 * It:
 *   1. Mints a fresh throwaway anonymous user by cold-hitting GET /api/assessment/status
 *      (middleware sets the co_anon cookie) — or uses --cookie <token> if provided.
 *   2. Confirms a freshly minted session starts as `not_started` for riasec.
 *   3. POSTs a complete all-3s RIASEC submission.
 *   4. Asserts HTTP 200 and that the returned scores deep-equal the local scorer's
 *      output for the same responses (proves deployed scoring == source of truth).
 *   5. Re-fetches status and asserts riasec is `completed` after submit.
 *
 * Usage:
 *   npx tsx scripts/smoke-assessment-submit.ts --allow-prod-write     # against prod
 *   BASE_URL=https://<preview>.vercel.app npx tsx scripts/smoke-assessment-submit.ts
 *   npx tsx scripts/smoke-assessment-submit.ts --cookie <co_anon>    # reuse a session
 *   npx tsx scripts/smoke-assessment-submit.ts --keep-data            # skip cleanup
 *
 * Side effect: creates ONE anonymous user + ONE riasec assessment row in the
 * target env's database — identical to what a real first-time visitor taking
 * RIASEC produces. Fresh smoke users are deleted at the end unless --keep-data
 * is passed. Cleanup requires target-env SUPABASE_SERVICE_ROLE_KEY plus
 * SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.
 */
import { createClient } from "@supabase/supabase-js";
import { RIASEC_ITEMS, RIASEC_ITEMS_VERSION } from "../lib/assessment/riasec/items";
import { scoreRiasec } from "../lib/assessment/riasec/score";

const PROD_BASE = "https://career-os-wine.vercel.app";
const BASE = normalizeBaseUrl(process.env.BASE_URL ?? PROD_BASE);
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  return url.origin;
}

function isProdTarget(base: string): boolean {
  return new URL(base).origin === new URL(PROD_BASE).origin;
}

function assertSmoke(condition: unknown, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

async function getStatus(cookieHeader: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/assessment/status`, {
    headers: { cookie: cookieHeader },
  });
  assertSmoke(res.ok, `GET /api/assessment/status -> ${res.status}`);
  return res.json() as Promise<Record<string, string>>;
}

function createServiceRoleClient() {
  assertSmoke(
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY,
    "cleanup requires SUPABASE_SERVICE_ROLE_KEY plus SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL; " +
      "set them or re-run with --keep-data",
  );
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getAnonymousUserId(token: string): Promise<string> {
  const svc = createServiceRoleClient();
  const { data, error } = await svc
    .from("anonymous_sessions")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  assertSmoke(data?.user_id, "could not find anonymous session for minted co_anon token");
  return data.user_id;
}

async function cleanupSmokeUser(userId: string): Promise<void> {
  const svc = createServiceRoleClient();
  const { error, count } = await svc
    .from("users")
    .delete({ count: "exact" })
    .eq("id", userId)
    .eq("is_anonymous", true);

  if (error) throw error;
  assertSmoke(count === 1, `cleanup deleted ${count ?? 0} anonymous users; expected 1`);
}

async function main(): Promise<void> {
  if (hasArg("--help")) {
    console.log(
      [
        "Usage:",
        "  npm run smoke:submit -- --allow-prod-write",
        "  BASE_URL=https://<preview>.vercel.app npm run smoke:submit",
        "  npm run smoke:submit -- --cookie <co_anon>",
        "  npm run smoke:submit -- --keep-data",
      ].join("\n"),
    );
    return;
  }

  console.log(`Target: ${BASE}`);
  if (isProdTarget(BASE)) {
    assertSmoke(
      hasArg("--allow-prod-write"),
      "refusing to write to production without --allow-prod-write",
    );
  }

  const providedToken = argValue("--cookie");
  const keepData = hasArg("--keep-data");
  let token = providedToken;
  let cleanupUserId: string | null = null;
  let runError: unknown;
  let cleanupError: unknown;

  try {
    if (!token) {
      if (!keepData) {
        createServiceRoleClient();
      }

      // Cold hit goes through the proxy/middleware, which mints co_anon.
      const res = await fetch(`${BASE}/api/assessment/status`, { redirect: "manual" });
      const setCookies = res.headers.getSetCookie();
      const co = setCookies.find((c) => c.startsWith("co_anon="));
      assertSmoke(
        co,
        "could not mint a co_anon cookie from GET /api/assessment/status — " +
          "re-run with --cookie <token> or check middleware cookie bootstrap",
      );
      token = co.split(";")[0].slice("co_anon=".length);
      console.log("✓ minted throwaway anonymous session");

      if (!keepData) {
        cleanupUserId = await getAnonymousUserId(token);
        console.log("✓ captured smoke user for cleanup");
      }
    } else {
      console.log("✓ using provided --cookie session");
      if (!keepData) {
        console.log("! cleanup disabled for provided --cookie session");
      }
    }

    const cookieHeader = `co_anon=${token}`;

    // 1. initial status
    const before = await getStatus(cookieHeader);
    console.log(`  initial riasec status: ${before.riasec}`);
    if (!providedToken) {
      assertSmoke(
        before.riasec === "not_started",
        `fresh smoke user should start with riasec=not_started (got "${before.riasec}")`,
      );
      console.log("✓ fresh session starts with riasec=not_started");
    }

    // 2. submit a complete all-3s RIASEC
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    const subRes = await fetch(`${BASE}/api/assessment/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ type: "riasec", responses }),
    });
    const sub = (await subRes.json()) as { id?: string; scores?: unknown; error?: string };

    assertSmoke(
      subRes.status === 200,
      `POST /api/assessment/submit -> ${subRes.status} ${JSON.stringify(sub)}`,
    );
    assertSmoke(sub.id, "submit response missing persisted row id");
    console.log(`✓ submit accepted (row id ${sub.id})`);

    // 3. deployed scores must equal the local source-of-truth scorer
    const expected = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
    const got = JSON.stringify(sub.scores);
    assertSmoke(
      got === JSON.stringify(expected),
      `deployed scores != local scorer\n  expected ${JSON.stringify(expected)}\n  got      ${got}`,
    );
    console.log(`✓ scores match local scorer (R=${expected.R}, code=${expected.hollandCode})`);

    // 4. persistence: status must be completed after submit
    const after = await getStatus(cookieHeader);
    assertSmoke(
      after.riasec === "completed",
      `status did not become completed (got "${after.riasec}")`,
    );
    if (before.riasec === "not_started") {
      console.log("✓ status flipped not_started -> completed (persisted)");
    } else {
      console.log(`✓ status is completed after submit (started as "${before.riasec}")`);
    }

    console.log("✓ assessment write path verified end-to-end");
  } catch (err) {
    runError = err;
  } finally {
    if (cleanupUserId) {
      try {
        await cleanupSmokeUser(cleanupUserId);
        console.log("✓ cleaned up smoke anonymous user");
      } catch (err) {
        cleanupError = err;
      }
    } else if (keepData) {
      console.log("! smoke data kept by --keep-data");
    }
  }

  if (runError && cleanupError) {
    console.error(
      `\x1b[33m! cleanup also failed\x1b[0m ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`,
    );
  }
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;

  console.log(`\n\x1b[32m✓ PASS\x1b[0m — assessment submit smoke passed on ${BASE}`);
}

main().catch((err) => {
  console.error(`\x1b[31m✗ FAIL\x1b[0m ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
