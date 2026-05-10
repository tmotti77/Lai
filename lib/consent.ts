import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export const CONSENT_VERSION = "2026-05-10";
export const CONSENT_PURPOSES = ["processing", "disclaimer"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export async function recordConsent(opts: {
  userId: string;
  purpose: ConsentPurpose;
  ipAddress?: string;
  userAgent?: string;
}) {
  const svc = createServiceClient();
  await svc.from("consents").insert({
    user_id: opts.userId,
    purpose: opts.purpose,
    version: CONSENT_VERSION,
    ip_address: opts.ipAddress,
    user_agent: opts.userAgent,
  });
}

export async function hasActiveConsent(userId: string, purpose: ConsentPurpose): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("consents")
    .select("id, accepted_at, revoked_at")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .eq("version", CONSENT_VERSION)
    .is("revoked_at", null)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}
