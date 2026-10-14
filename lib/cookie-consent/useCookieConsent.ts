"use client";

import { useSyncExternalStore } from "react";
import { getServerStatus, getStatus, subscribe, type CookieConsentStatus } from "./store";

export function useCookieConsent(): CookieConsentStatus | "unknown" {
  return useSyncExternalStore(subscribe, getStatus, getServerStatus);
}
