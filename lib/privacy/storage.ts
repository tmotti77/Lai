import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { STORAGE_BUCKETS, type StorageBucket } from "@/lib/privacy/registry";

type ServiceClient = ReturnType<typeof createServiceClient>;

const LIST_PAGE = 100;
const REMOVE_BATCH = 100;

export interface StoredObject {
  bucket: StorageBucket;
  path: string;
  size: number | null;
}

/**
 * Every object under the user's folder in every registered bucket. Listing (not just
 * reading cv_uploads.storage_path) matters: the upload route stores the file before it
 * inserts the row, so a failed insert leaves an object no row points to.
 */
export async function listUserObjects(svc: ServiceClient, userId: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  for (const [bucket, spec] of Object.entries(STORAGE_BUCKETS) as [StorageBucket, (typeof STORAGE_BUCKETS)[StorageBucket]][]) {
    const folder = spec.folder(userId);
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await svc.storage.from(bucket).list(folder, { limit: LIST_PAGE, offset });
      if (error) throw error;
      for (const item of data ?? []) {
        // Sub-folders come back with a null id. CVs are stored flat, so there are none to recurse into.
        if (item.id === null) continue;
        const size = (item.metadata as { size?: number } | null)?.size;
        out.push({ bucket, path: `${folder}/${item.name}`, size: typeof size === "number" ? size : null });
      }
      if (!data || data.length < LIST_PAGE) break;
    }
  }
  return out;
}

/** Removes paths in batches. Missing objects are not an error. Returns how many were removed. */
export async function removeObjects(
  svc: ServiceClient,
  bucket: StorageBucket,
  paths: readonly string[],
): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { data, error } = await svc.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw error;
    removed += data?.length ?? 0;
  }
  return removed;
}
