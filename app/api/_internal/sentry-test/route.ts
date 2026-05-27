import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authOk(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.ADMIN_EXPORT_TOKEN;
  if (!token || !expected) return false;
  const tokenBuf = Buffer.from(token, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (tokenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(tokenBuf, expectedBuf);
}

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_EXPORT_TOKEN) {
    return NextResponse.json({ error: "smoke_disabled" }, { status: 503 });
  }
  if (!authOk(req)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  // Lazy import: keeps @sentry/nextjs out of the dev module graph so Turbopack
  // never tries to bundle @sentry/node-core (which fails on require-in-the-middle).
  // This route is only ever hit against deployed prod URLs.
  const Sentry = await import("@sentry/nextjs");
  const eventId = Sentry.captureException(
    new Error("phase-7a smoke: sentry pipeline verification")
  );
  await Sentry.flush(5000);

  return NextResponse.json({ eventId });
}
