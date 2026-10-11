import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { CurrentUserIds } from "@/lib/anonymous";
import { he } from "@/lib/i18n/he";
import {
  USER_DATA_TABLES,
  USER_DATA_TABLE_NAMES,
  type StorageBucket,
  type TableSpec,
  type UserDataTable,
} from "@/lib/privacy/registry";
import { listUserObjects } from "@/lib/privacy/storage";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Row = Record<string, unknown>;

export const EXPORT_FORMAT_VERSION = 1;
export const SIGNED_URL_TTL_SECONDS = 15 * 60;
// PostgREST caps every response at max_rows (1000 by default), so every read is paged.
const PAGE_SIZE = 1000;
// Keeps `in.(…)` filters well under URL length limits.
const ID_CHUNK = 200;

const NOTICE_EN =
  "This file contains all the data CareerOS holds about you: account, consents, conversations, " +
  "questionnaires, career profile, recommendations, plans, CVs, interview practice and feedback. " +
  "CV download links expire 15 minutes after export. The anonymous session token is redacted for security.";

export interface ExportedObject {
  bucket: StorageBucket;
  path: string;
  original_filename: string | null;
  size_bytes: number | null;
  signed_url: string | null;
  expires_at: string | null;
  available: boolean;
}

export interface UserDataSnapshot {
  user_id: string;
  tables: Record<UserDataTable, Row[]>;
  storage: ExportedObject[];
}

export interface AuthProfile {
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
}

export interface ExportBundle {
  format_version: number;
  exported_at: string;
  notice_he: string;
  notice_en: string;
  account: { user_id: string; is_anonymous: boolean; auth: AuthProfile | null };
  tables: Record<UserDataTable, Row[]>;
  storage: ExportedObject[];
  linked_anonymous: UserDataSnapshot | null;
}

// Tables are iterated from the registry at runtime, so the per-table column types from
// types.gen.ts can't follow; the registry's table names are checked against them by tsc.
interface LooseQuery extends PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
  eq(column: string, value: unknown): LooseQuery;
  in(column: string, values: readonly unknown[]): LooseQuery;
  order(column: string, opts?: { ascending?: boolean }): LooseQuery;
  range(from: number, to: number): LooseQuery;
}

async function readAll(
  svc: ServiceClient,
  table: UserDataTable,
  pk: string,
  filter: (q: LooseQuery) => LooseQuery,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const base = svc.from(table).select("*") as unknown as LooseQuery;
    const { data, error } = await filter(base).order(pk).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`export ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function readTables(svc: ServiceClient, userId: string): Promise<Record<UserDataTable, Row[]>> {
  const tables = {} as Record<UserDataTable, Row[]>;
  // Registry order is parents-first, so a child's parent rows are already loaded.
  for (const table of USER_DATA_TABLE_NAMES) {
    const spec: TableSpec = USER_DATA_TABLES[table];
    const pk = spec.pk ?? "id";
    const scope = spec.scope;
    let rows: Row[];
    if (scope.kind === "root") {
      rows = await readAll(svc, table, pk, (q) => q.eq("id", userId));
    } else if (scope.kind === "user_id") {
      rows = await readAll(svc, table, pk, (q) => q.eq("user_id", userId));
    } else {
      const parentIds = tables[scope.parent as UserDataTable].map((r) => r.id);
      rows = [];
      for (let i = 0; i < parentIds.length; i += ID_CHUNK) {
        const chunk = parentIds.slice(i, i + ID_CHUNK);
        rows.push(...(await readAll(svc, table, pk, (q) => q.in(scope.fk, chunk))));
      }
    }
    tables[table] = spec.redact
      ? rows.map((r) => ({ ...r, ...Object.fromEntries(spec.redact!.map((c) => [c, "[redacted]"])) }))
      : rows;
  }
  return tables;
}

async function readStorage(svc: ServiceClient, userId: string, cvRows: Row[]): Promise<ExportedObject[]> {
  const objects = new Map<string, Omit<ExportedObject, "signed_url" | "expires_at" | "available">>();
  for (const o of await listUserObjects(svc, userId)) {
    objects.set(`${o.bucket}:${o.path}`, { bucket: o.bucket, path: o.path, original_filename: null, size_bytes: o.size });
  }
  // Union with the rows: a row can outlive its object (bucket lifecycle), and a path
  // outside the user's folder would not be listed.
  for (const row of cvRows) {
    const path = String(row.storage_path);
    const key = `cv-uploads:${path}`;
    const existing = objects.get(key);
    objects.set(key, {
      bucket: "cv-uploads",
      path,
      original_filename: (row.original_filename as string | null) ?? null,
      size_bytes: existing?.size_bytes ?? (row.size_bytes as number | null) ?? null,
    });
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  const out: ExportedObject[] = [];
  for (const o of objects.values()) {
    const download = o.original_filename ?? o.path.split("/").pop() ?? o.path;
    const { data, error } = await svc.storage
      .from(o.bucket)
      .createSignedUrl(o.path, SIGNED_URL_TTL_SECONDS, { download });
    // A missing object (already deleted, or swept by the 30-day lifecycle) is reported, not fatal.
    const signed = !error && data?.signedUrl ? data.signedUrl : null;
    out.push({ ...o, signed_url: signed, expires_at: signed ? expiresAt : null, available: signed !== null });
  }
  return out;
}

async function snapshot(svc: ServiceClient, userId: string): Promise<UserDataSnapshot> {
  const tables = await readTables(svc, userId);
  const storage = await readStorage(svc, userId, tables.cv_uploads);
  return { user_id: userId, tables, storage };
}

/**
 * Everything we hold about the caller. Reads use the service role (RLS can't serve
 * anonymous users); isolation comes from every query being scoped by the caller's own
 * user id or by parent ids already scoped that way.
 */
export async function buildUserExport(ids: CurrentUserIds, auth: AuthProfile | null): Promise<ExportBundle> {
  const svc = createServiceClient();
  const primary = await snapshot(svc, ids.primaryId);
  const linked = ids.linkedAnonymousId ? await snapshot(svc, ids.linkedAnonymousId) : null;
  return {
    format_version: EXPORT_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    notice_he: he.settings.export.fileNotice,
    notice_en: NOTICE_EN,
    account: { user_id: ids.primaryId, is_anonymous: ids.isAnonymous, auth },
    tables: primary.tables,
    storage: primary.storage,
    linked_anonymous: linked,
  };
}
