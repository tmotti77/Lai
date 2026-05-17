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

export class NoConsentError extends Error {
  constructor(public missing: string[]) {
    super(`no_consent: missing ${missing.join(", ")}`);
    this.name = "NoConsentError";
  }
}

const DEFAULT_REQUIRED_PURPOSES: ReadonlyArray<ConsentPurpose> = [
  "processing",
  "disclaimer",
] as const;

/**
 * Throws NoConsentError if the user is missing active consent for any
 * required purpose. Resolves silently when all required consents are active.
 *
 * Call this at the top of any API route that mutates user data or sends
 * data to third parties (LLM providers, etc.).
 */
export async function requireConsent(
  userId: string,
  purposes: ReadonlyArray<ConsentPurpose> = DEFAULT_REQUIRED_PURPOSES,
): Promise<void> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("consents")
    .select("purpose, revoked_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .in("purpose", purposes as readonly string[]);
  if (error) throw new Error(`requireConsent: ${error.message}`);

  const have = new Set((data ?? []).map((r) => r.purpose as string));
  const missing = purposes.filter((p) => !have.has(p));
  if (missing.length > 0) throw new NoConsentError(missing);
}
