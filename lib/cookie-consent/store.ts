import {
  COOKIE_CONSENT_STORAGE_KEY,
  readPreference,
  writePreference,
  type CookiePreference,
} from "./preference";

export type CookieConsentStatus = "unset" | "granted" | "denied";

const CONSENT_EVENT = "careeros:cookie-consent";

let memory: CookiePreference | null = null;
let memoryIsOverride = false;

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentPreference(): CookiePreference | null {
  if (memoryIsOverride) return memory;
  return readPreference(getLocalStorage());
}

export function getStatus(): CookieConsentStatus {
  const pref = currentPreference();
  if (!pref) return "unset";
  return pref.analytics ? "granted" : "denied";
}

export function getServerStatus(): "unknown" {
  return "unknown";
}

export function hasAnalyticsConsent(): boolean {
  return getStatus() === "granted";
}

export function setAnalyticsConsent(granted: boolean): boolean {
  const { preference, persisted } = writePreference(getLocalStorage(), granted, new Date());
  memory = preference;
  memoryIsOverride = !persisted;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { persisted } }));
  }
  return persisted;
}

export function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleConsentEvent = () => callback();
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== null && event.key !== COOKIE_CONSENT_STORAGE_KEY) return;
    // A storage event only fires for a real write from another tab, so it's
    // evidence storage is usable again — clear any in-memory override.
    memory = null;
    memoryIsOverride = false;
    callback();
  };

  window.addEventListener(CONSENT_EVENT, handleConsentEvent);
  window.addEventListener("storage", handleStorageEvent);
  return () => {
    window.removeEventListener(CONSENT_EVENT, handleConsentEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}
