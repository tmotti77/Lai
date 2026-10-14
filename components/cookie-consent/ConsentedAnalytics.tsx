"use client";

import { Analytics } from "@vercel/analytics/next";
import { useCookieConsent } from "@/lib/cookie-consent/useCookieConsent";
import { hasAnalyticsConsent } from "@/lib/cookie-consent/store";

// Default-deny (decision 3): the Vercel script is only ever injected once the stored
// preference is "granted". beforeSend re-reads the live preference on every event so a
// mid-session revoke nulls events without needing to unmount+reload (decision 5).
export function ConsentedAnalytics() {
  const status = useCookieConsent();
  if (status !== "granted") return null;
  return <Analytics beforeSend={(event) => (hasAnalyticsConsent() ? event : null)} />;
}
