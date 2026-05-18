import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { NpsTrigger } from "@/lib/analytics";

export async function markNpsEligibilityIfFirst(
  userId: string,
  trigger: NpsTrigger
): Promise<void> {
  const supabase = createServiceClient();
  // Atomic: only updates if currently null (first-trigger wins).
  await supabase
    .from("users")
    .update({
      nps_eligibility_first_at: new Date().toISOString(),
      nps_trigger_first: trigger,
    })
    .eq("id", userId)
    .is("nps_eligibility_first_at", null);
}

export async function getNpsEligibility(userId: string): Promise<{
  show: boolean;
  trigger: NpsTrigger | null;
}> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select(
      "nps_eligibility_first_at, nps_submitted_at, nps_dismissed_at, nps_trigger_first"
    )
    .eq("id", userId)
    .maybeSingle();

  const show =
    !!data?.nps_eligibility_first_at &&
    !data.nps_submitted_at &&
    !data.nps_dismissed_at;

  return { show, trigger: (data?.nps_trigger_first as NpsTrigger | null) ?? null };
}
