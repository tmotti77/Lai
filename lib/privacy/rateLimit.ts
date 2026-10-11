import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// No Redis in the stack and nothing durable in serverless memory, so limits are guarded
// UPDATE … RETURNING on the user row: the claim and the check are one statement, with no
// race window (same atomic-transition pattern as Phase 6b).

export const EXPORT_COOLDOWN_SECONDS = 60;
/** A crashed deletion can be retried once its lock is this old. */
export const DELETION_LOCK_TTL_SECONDS = 120;

function cutoff(seconds: number): string {
  // Quoted: PostgREST logic-tree values with ":" or "." are safest quoted.
  return `"${new Date(Date.now() - seconds * 1000).toISOString()}"`;
}

/** True if this user may export now (and records the export time). */
export async function claimExportSlot(userId: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("users")
    .update({ last_export_at: new Date().toISOString() })
    .eq("id", userId)
    .or(`last_export_at.is.null,last_export_at.lt.${cutoff(EXPORT_COOLDOWN_SECONDS)}`)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`claimExportSlot: ${error.message}`);
  return data !== null;
}

export type DeletionLock = "claimed" | "held" | "gone";

export async function claimDeletionLock(userId: string): Promise<DeletionLock> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("users")
    .update({ deletion_requested_at: new Date().toISOString() })
    .eq("id", userId)
    .or(`deletion_requested_at.is.null,deletion_requested_at.lt.${cutoff(DELETION_LOCK_TTL_SECONDS)}`)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`claimDeletionLock: ${error.message}`);
  if (data) return "claimed";

  const { data: exists, error: readErr } = await svc.from("users").select("id").eq("id", userId).maybeSingle();
  if (readErr) throw new Error(`claimDeletionLock: ${readErr.message}`);
  return exists ? "held" : "gone";
}

/** Lets the user retry immediately after a handled failure, instead of waiting out the TTL. */
export async function releaseDeletionLock(userId: string): Promise<void> {
  const svc = createServiceClient();
  await svc.from("users").update({ deletion_requested_at: null }).eq("id", userId);
}
