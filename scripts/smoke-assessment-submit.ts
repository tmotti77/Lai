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
 *   2. Confirms the initial status is `not_started` for riasec.
 *   3. POSTs a complete all-3s RIASEC submission.
 *   4. Asserts HTTP 200 and that the returned scores deep-equal the local scorer's
 *      output for the same responses (proves deployed scoring == source of truth).
 *   5. Re-fetches status and asserts riasec flipped to `completed` (proves persistence).
 *
 * Usage:
 *   npx tsx scripts/smoke-assessment-submit.ts                       # against prod
 *   BASE_URL=https://<preview>.vercel.app npx tsx scripts/smoke-assessment-submit.ts
 *   npx tsx scripts/smoke-assessment-submit.ts --cookie <co_anon>    # reuse a session
 *
 * Side effect: creates ONE anonymous user + ONE riasec assessment row in the target
 * env's database — identical to what a real first-time visitor taking RIASEC produces.
 */
import { RIASEC_ITEMS, RIASEC_ITEMS_VERSION } from "../lib/assessment/riasec/items";
import { scoreRiasec } from "../lib/assessment/riasec/score";

const BASE = process.env.BASE_URL ?? "https://career-os-wine.vercel.app";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(`\x1b[31m✗ FAIL\x1b[0m ${msg}`);
  process.exit(1);
}

async function getStatus(cookieHeader: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/assessment/status`, {
    headers: { cookie: cookieHeader },
  });
  if (!res.ok) fail(`GET /api/assessment/status -> ${res.status}`);
  return res.json() as Promise<Record<string, string>>;
}

async function main(): Promise<void> {
  console.log(`Target: ${BASE}`);
  let token = argValue("--cookie");

  if (!token) {
    // Cold hit goes through the proxy/middleware, which mints co_anon.
    const res = await fetch(`${BASE}/api/assessment/status`, { redirect: "manual" });
    const setCookies = res.headers.getSetCookie();
    const co = setCookies.find((c) => c.startsWith("co_anon="));
    if (!co) {
      fail(
        "could not mint a co_anon cookie from GET /api/assessment/status — " +
          "re-run with --cookie <token>",
      );
    }
    token = co.split(";")[0].slice("co_anon=".length);
    console.log("✓ minted throwaway anonymous session");
  } else {
    console.log("✓ using provided --cookie session");
  }

  const cookieHeader = `co_anon=${token}`;

  // 1. initial status
  const before = await getStatus(cookieHeader);
  console.log(`  initial riasec status: ${before.riasec}`);

  // 2. submit a complete all-3s RIASEC
  const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
  const subRes = await fetch(`${BASE}/api/assessment/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ type: "riasec", responses }),
  });
  const sub = (await subRes.json()) as { id?: string; scores?: unknown; error?: string };

  if (subRes.status !== 200) {
    fail(`POST /api/assessment/submit -> ${subRes.status} ${JSON.stringify(sub)}`);
  }
  if (!sub.id) fail("submit response missing persisted row id");
  console.log(`✓ submit accepted (row id ${sub.id})`);

  // 3. deployed scores must equal the local source-of-truth scorer
  const expected = scoreRiasec(responses, RIASEC_ITEMS_VERSION);
  const got = JSON.stringify(sub.scores);
  if (got !== JSON.stringify(expected)) {
    fail(`deployed scores != local scorer\n  expected ${JSON.stringify(expected)}\n  got      ${got}`);
  }
  console.log(`✓ scores match local scorer (R=${expected.R}, code=${expected.hollandCode})`);

  // 4. persistence: status must flip to completed
  const after = await getStatus(cookieHeader);
  if (after.riasec !== "completed") {
    fail(`status did not flip to completed (got "${after.riasec}")`);
  }
  console.log(`✓ status flipped not_started -> completed (persisted)`);

  console.log(`\n\x1b[32m✓ PASS\x1b[0m — assessment write path verified end-to-end on ${BASE}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
