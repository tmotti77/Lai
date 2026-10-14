export const COOKIE_CONSENT_VERSION = 1;
export const COOKIE_CONSENT_STORAGE_KEY = "careeros.cookieConsent";

export type CookiePreference = {
  v: number;
  analytics: boolean;
  at: string;
};

type MinimalStorage = Pick<Storage, "getItem">;

function isCookiePreference(value: unknown): value is CookiePreference {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === COOKIE_CONSENT_VERSION &&
    typeof v.analytics === "boolean" &&
    typeof v.at === "string"
  );
}

export function readPreference(storage: MinimalStorage | null): CookiePreference | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(COOKIE_CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isCookiePreference(parsed) ? parsed : null;
}

export function writePreference(
  storage: Pick<Storage, "setItem"> | null,
  analytics: boolean,
  now: Date
): { preference: CookiePreference; persisted: boolean } {
  const preference: CookiePreference = { v: COOKIE_CONSENT_VERSION, analytics, at: now.toISOString() };
  if (!storage) return { preference, persisted: false };
  try {
    storage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(preference));
    return { preference, persisted: true };
  } catch {
    return { preference, persisted: false };
  }
}

export function clearPreference(storage: Pick<Storage, "removeItem"> | null): void {
  if (!storage) return;
  try {
    storage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
  } catch {
    // Ignore — clearing is best-effort, same as writePreference.
  }
}
