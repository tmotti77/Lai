import "server-only";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";
import { USER_DATA_TABLE_NAMES, type StorageBucket, type UserDataTable } from "@/lib/privacy/registry";
import { claimDeletionLock, releaseDeletionLock } from "@/lib/privacy/rateLimit";
import { listUserObjects, removeObjects } from "@/lib/privacy/storage";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Wire token the client must send. ASCII and stable; the Hebrew typed word is UI only. */
export const DELETE_CONFIRMATION = "DELETE_MY_ACCOUNT";
export const DeleteRequestBody = z.object({ confirmation: z.literal(DELETE_CONFIRMATION) });

export type DeletionStage = "lock" | "storage" | "db" | "auth";

export class DeletionStageError extends Error {
  constructor(
    public stage: DeletionStage,
    cause: unknown,
  ) {
    super(`account deletion failed at stage ${stage}`, { cause });
    this.name = "DeletionStageError";
  }
}

export class DeletionInProgressError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("account deletion already in progress");
    this.name = "DeletionInProgressError";
  }
}

export interface DeleteTarget {
  /** users.id; null when the session's account rows are already gone (a retry). */
  primaryId: string | null;
  /** auth.users.id from the session; null for anonymous visitors. */
  authId: string | null;
  linkedAnonymousId: string | null;
}

export interface DeleteReport {
  tables: Record<UserDataTable, number>;
  storage_objects: number;
  /**
   * "incomplete": rows and account are gone, but objects may remain under the user's folder.
   * "not_checked": no account rows were left to resolve a folder from (a retry or replay).
   */
  storage_cleanup: "complete" | "incomplete" | "not_checked";
  auth_user: "deleted" | "absent" | "n/a";
}

async function releaseLocks(userIds: readonly string[]): Promise<void> {
  await Promise.all(userIds.map(releaseDeletionLock));
}

function fail(stage: DeletionStage, err: unknown, userId: string | null): DeletionStageError {
  Sentry.captureException(err, { tags: { context: "account_delete", stage }, extra: { userId } });
  return new DeletionStageError(stage, err);
}

async function deleteStorage(svc: ServiceClient, userId: string): Promise<number> {
  const byBucket = new Map<StorageBucket, Set<string>>();
  const add = (bucket: StorageBucket, path: string) => {
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
    byBucket.get(bucket)!.add(path);
  };
  for (const o of await listUserObjects(svc, userId)) add(o.bucket, o.path);
  // Rows can point outside the listed folder; read them before stage 2 deletes them.
  const { data: rows, error } = await svc.from("cv_uploads").select("storage_path").eq("user_id", userId);
  if (error) throw error;
  for (const r of rows ?? []) add("cv-uploads", r.storage_path);

  let removed = 0;
  for (const [bucket, paths] of byBucket) removed += await removeObjects(svc, bucket, [...paths]);
  return removed;
}

const SWEEP_ATTEMPTS = 3;

/**
 * Catches a CV uploaded between stage 1 and stage 2. The upload route refuses new uploads
 * while the lock is held and removes its object when the row insert fails, so this is the
 * last line, not the only one. By now the user's rows are gone, so a client retry could no
 * longer find this folder: retry here instead, and on persistent failure report it (Sentry
 * error with the user id for manual cleanup) rather than claim a complete deletion.
 */
async function sweepStorage(svc: ServiceClient, userId: string): Promise<{ removed: number; complete: boolean }> {
  let removed = 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < SWEEP_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    try {
      const late = await listUserObjects(svc, userId);
      for (const bucket of new Set(late.map((o) => o.bucket))) {
        removed += await removeObjects(svc, bucket, late.filter((o) => o.bucket === bucket).map((o) => o.path));
      }
      return { removed, complete: true };
    } catch (err) {
      lastErr = err;
    }
  }
  Sentry.captureException(lastErr, {
    level: "error",
    tags: { context: "account_delete", stage: "storage_sweep" },
    extra: { userId },
  });
  console.error("[privacy] delete: storage cleanup incomplete", { userId });
  return { removed, complete: false };
}

async function deleteRows(svc: ServiceClient, userId: string): Promise<Record<string, number>> {
  const { data, error } = await svc.rpc("delete_user_data", { p_user_id: userId });
  if (error) throw error;
  return (data ?? {}) as Record<string, number>;
}

async function deleteAuthUser(svc: ServiceClient, authId: string): Promise<"deleted" | "absent"> {
  const { error } = await svc.auth.admin.deleteUser(authId);
  if (!error) return "deleted";
  if (error.status === 404 || error.code === "user_not_found") return "absent";
  throw error;
}

/**
 * Hard-deletes everything we hold about the target. Stages, per users.id:
 *   0. lock     guarded UPDATE on users.deletion_requested_at (409 if held)
 *   1. storage  objects under the user's folder ∪ cv_uploads paths; abort before the DB on failure
 *   2. db       delete_user_data RPC, one transaction (rolls back on failure)
 *   2b. sweep   re-list and remove late uploads; retried, then reported as storage_cleanup "incomplete"
 * then 3. auth: auth.admin.deleteUser, last so the caller keeps a working session to retry with.
 *
 * Every stage is idempotent, so a retry restarts from stage 0 and converges.
 */
export async function deleteUserData(target: DeleteTarget): Promise<DeleteReport> {
  const svc = createServiceClient();
  const report: DeleteReport = {
    tables: Object.fromEntries(USER_DATA_TABLE_NAMES.map((t) => [t, 0])) as Record<UserDataTable, number>,
    storage_objects: 0,
    storage_cleanup: "complete",
    auth_user: "n/a",
  };
  const userIds = [...new Set([target.primaryId, target.linkedAnonymousId].filter((id): id is string => id !== null))];

  // Claim every lock before touching anything, so a concurrent request can't interleave.
  const claimed: string[] = [];
  for (const id of userIds) {
    let lock;
    try {
      lock = await claimDeletionLock(id);
    } catch (err) {
      await releaseLocks(claimed);
      throw fail("lock", err, id);
    }
    if (lock.state === "held") {
      await releaseLocks(claimed);
      throw new DeletionInProgressError(lock.retryAfterSeconds);
    }
    // "gone": the rows were deleted by an earlier attempt; only the auth stage may remain.
    if (lock.state === "claimed") claimed.push(id);
  }

  if (claimed.length === 0) report.storage_cleanup = "not_checked";
  for (const id of claimed) {
    try {
      report.storage_objects += await deleteStorage(svc, id);
    } catch (err) {
      await releaseLocks(claimed);
      throw fail("storage", err, id);
    }
    let counts: Record<string, number>;
    try {
      counts = await deleteRows(svc, id);
    } catch (err) {
      await releaseLocks(claimed);
      throw fail("db", err, id);
    }
    for (const t of USER_DATA_TABLE_NAMES) report.tables[t] += Number(counts[t] ?? 0);
    const sweep = await sweepStorage(svc, id);
    report.storage_objects += sweep.removed;
    if (!sweep.complete) report.storage_cleanup = "incomplete";
  }

  if (target.authId) {
    try {
      report.auth_user = await deleteAuthUser(svc, target.authId);
    } catch (err) {
      throw fail("auth", err, target.primaryId);
    }
  }

  console.info("[privacy] delete", {
    tables: report.tables,
    storage_objects: report.storage_objects,
    storage_cleanup: report.storage_cleanup,
  });
  return report;
}
