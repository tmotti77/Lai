import { describe, it, expect } from "vitest";
import { POST as submitPost } from "@/app/api/assessment/submit/route";
import { RIASEC_ITEMS } from "@/lib/assessment/riasec/items";

function fakeRequest(body: unknown): Request {
  return new Request("http://localhost/api/assessment/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/assessment/submit", () => {
  it("rejects invalid type", async () => {
    const res = await submitPost(fakeRequest({ type: "nope", responses: {} }));
    expect(res.status).toBe(400);
  });

  // Skipped: route calls createClient() (which invokes next/headers `cookies()`)
  // BEFORE the riasec-completeness check, so we can't reach the 400 path without
  // a request scope. Validating this requires E2E (Playwright) or a request-scope shim.
  it.skip("rejects incomplete RIASEC", async () => {
    const res = await submitPost(fakeRequest({ type: "riasec", responses: { R1: 3 } }));
    expect(res.status).toBe(400);
  });

  // Skipped: success path calls createClient() + getOrCreateAnonymousUserId() +
  // saveAssessment(), all of which require a Next request scope and a real Supabase
  // instance. Belongs in a Playwright E2E (Phase 6+), not a unit/integration vitest run.
  it.skip("accepts complete RIASEC submission and returns scores", async () => {
    const responses = Object.fromEntries(RIASEC_ITEMS.map((i) => [i.id, 3]));
    const res = await submitPost(fakeRequest({ type: "riasec", responses }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scores).toBeDefined();
    expect(json.scores.R).toBe(50);
  });
});
