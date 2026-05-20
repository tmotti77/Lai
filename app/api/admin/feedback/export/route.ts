import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const VALID_SURFACES = new Set(["chat", "recommendations", "interview", "nps"]);
const FORMULA_INJECTION = /^[=+\-@\t\r]/;

export function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const raw = typeof v === "string" ? v : JSON.stringify(v);
  const safe = FORMULA_INJECTION.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function authOk(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.ADMIN_EXPORT_TOKEN;
  if (!token || !expected) return false;
  const tokenBuf = Buffer.from(token, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (tokenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(tokenBuf, expectedBuf);
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return new NextResponse("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const surface = url.searchParams.get("surface");

  if (since && Number.isNaN(new Date(since).getTime())) {
    return NextResponse.json({ error: "invalid_since" }, { status: 400 });
  }
  if (surface && !VALID_SURFACES.has(surface)) {
    return NextResponse.json({ error: "invalid_surface" }, { status: 400 });
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("feedback")
    .select("id, user_id, surface, target_type, target_id, thumbs_value, nps_score, nps_trigger, comment_he, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(10000);

  if (since) query = query.gte("created_at", since);
  if (surface) query = query.eq("surface", surface);

  const { data, error } = await query;
  if (error) return new NextResponse("query_failed", { status: 500 });

  const headers = ["id","user_id","surface","target_type","target_id","thumbs_value","nps_score","nps_trigger","comment_he","metadata","created_at"];
  const csv = [
    headers.join(","),
    ...(data ?? []).map((row) =>
      headers.map((h) => escapeCsv((row as Record<string, unknown>)[h])).join(",")
    ),
  ].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
