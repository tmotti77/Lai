import { he } from "@/lib/i18n/he";

// Maps the data-rights routes' error contract (app/api/me/export/route.ts,
// app/api/me/route.ts) to user-facing text. Pure, so the mapping is unit-tested.

/** Export cooldown, mirrors EXPORT_COOLDOWN_SECONDS; only used if retry_after_s is missing. */
const DEFAULT_RETRY_AFTER_S = 60;

export function exportErrorMessage(status: number, error?: string, retryAfterS?: number): string {
  const t = he.settings.export.errors;
  if (status === 429) return t.rateLimited.replace("{seconds}", String(retryAfterS ?? DEFAULT_RETRY_AFTER_S));
  if (status === 401 && error === "session_expired") return t.sessionExpired;
  if (status === 401 && error === "no_identity") return t.noData;
  if (status === 503) return t.unavailable;
  return t.generic;
}

export function deleteErrorMessage(status: number, error?: string): string {
  const t = he.settings.delete.errors;
  if (status === 409) return t.inProgress;
  if (status === 401 && error === "session_expired") return t.sessionExpired;
  if (status === 401 && error === "no_identity") return t.noData;
  if (status === 503) return t.unavailable;
  if (status === 500 && error === "deletion_incomplete") return t.incomplete;
  return t.generic;
}
