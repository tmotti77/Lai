import { describe, it, expect, beforeAll, vi } from "vitest";
import { config } from "dotenv";
import path from "node:path";

// Load .env.local with override so real credentials replace stubs set by
// tests/setup.ts. Must happen before any call to createServiceClient() since
// lib/env.ts captures process.env at module-evaluation time.
config({ path: path.resolve(__dirname, "../../.env.local"), override: true });

const HAS_REAL_DB =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith("stub");

// Mock createServiceClient to use a real-env client (same pattern as feedback-route.test.ts)
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    const { createClient } = require("@supabase/supabase-js");
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  },
}));

import { GET } from "@/app/api/admin/feedback/export/route";

const TOKEN = "test-token-" + crypto.randomUUID();

beforeAll(() => {
  process.env.ADMIN_EXPORT_TOKEN = TOKEN;
});

function authReq(qs: string = ""): Request {
  return new Request(`http://test/api/admin/feedback/export${qs}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

describe("GET /api/admin/feedback/export", () => {
  it("returns 401 without token", async () => {
    const res = await GET(new Request("http://test/api/admin/feedback/export") as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await GET(new Request("http://test/api/admin/feedback/export", {
      headers: { authorization: "Bearer wrong-token-different-length" },
    }) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid since param", async () => {
    const res = await GET(authReq("?since=not-a-date") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid surface param", async () => {
    const res = await GET(authReq("?surface=bogus") as never);
    expect(res.status).toBe(400);
  });

  it.skipIf(!HAS_REAL_DB)("returns CSV with correct headers on auth + valid query", async () => {
    const res = await GET(authReq() as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("feedback-");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await res.text();
    expect(text.split("\n")[0]).toBe("id,user_id,surface,target_type,target_id,thumbs_value,nps_score,nps_trigger,comment_he,metadata,created_at");
  });
});
