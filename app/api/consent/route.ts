import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { recordConsent, hasActiveConsent, CONSENT_PURPOSES } from "@/lib/consent";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);
  const processing = await hasActiveConsent(userId, "processing");
  const disclaimer = await hasActiveConsent(userId, "disclaimer");
  return NextResponse.json({ processing, disclaimer });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);
  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;

  for (const purpose of CONSENT_PURPOSES) {
    await recordConsent({ userId, purpose, ipAddress, userAgent });
  }
  return NextResponse.json({ ok: true });
}
