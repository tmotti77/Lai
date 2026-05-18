import { NextResponse } from "next/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { requireConsent, NoConsentError } from "@/lib/consent";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST() {
  let userId: string;
  try {
    userId = await getOrCreateAnonymousUserId();
    await requireConsent(userId);
  } catch (err) {
    if (err instanceof NoConsentError) {
      return NextResponse.json({ error: "consent_required" }, { status: 403 });
    }
    throw err;
  }

  const supabase = createServiceClient();
  await supabase
    .from("users")
    .update({ nps_dismissed_at: new Date().toISOString() })
    .eq("id", userId)
    .is("nps_dismissed_at", null);

  return new NextResponse(null, { status: 204 });
}
