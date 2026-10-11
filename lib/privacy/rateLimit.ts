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

export type DeletionLock =
  | { state: "claimed" }
  | { state: "gone" }
  /** retryAfterSeconds: until the lock expires, at least 1. */
  | { state: "held"; retryAfterSeconds: number };

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
  if (data) return { state: "claimed" };

  const { data: row, error: readErr } = await svc
    .from("users")
    .select("deletion_requested_at")
    .eq("id", userId)
    .maybeSingle();
  if (readErr) throw new Error(`claimDeletionLock: ${readErr.message}`);
  if (!row) return { state: "gone" };
  const heldFor = row.deletion_requested_at ? Date.now() - Date.parse(row.deletion_requested_at) : 0;
  const retryAfterSeconds = Math.max(1, Math.ceil(DELETION_LOCK_TTL_SECONDS - heldFor / 1000));
  return { state: "held", retryAfterSeconds };
}

/**
 * True while a deletion holds this user's lock. Writers that create data outside the
 * delete_user_data transaction (CV objects in Storage) check it first.
 */
export async function isDeletionInProgress(userId: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("users")
    .select("id")
    .eq("id", userId)
    .gt("deletion_requested_at", new Date(Date.now() - DELETION_LOCK_TTL_SECONDS * 1000).toISOString())
    .maybeSingle();
  if (error) throw new Error(`isDeletionInProgress: ${error.message}`);
  return data !== null;
}

/** Lets the user retry immediately after a handled failure, instead of waiting out the TTL. */
export async function releaseDeletionLock(userId: string): Promise<void> {
  const svc = createServiceClient();
  await svc.from("users").update({ deletion_requested_at: null }).eq("id", userId);
}
