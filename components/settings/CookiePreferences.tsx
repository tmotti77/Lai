"use client";

import { Card } from "@/components/ui/card";
import { he } from "@/lib/i18n/he";
import { useCookieConsent } from "@/lib/cookie-consent/useCookieConsent";
import { setAnalyticsConsent } from "@/lib/cookie-consent/store";

// Shares the same store (lib/cookie-consent/store.ts) as CookieBanner, so toggling here
// fires the same event and hides a mounted banner without a reload. Cookie choice doesn't
// depend on identity or sign-in, so it renders in every /settings view state.
export function CookiePreferences() {
  const status = useCookieConsent();
  const c = he.cookieConsent;
  const granted = status === "granted";
  const isUnknown = status === "unknown";
  const isUnset = isUnknown || status === "unset";

  const statusText = isUnset ? c.settings.unset : granted ? c.settings.on : c.settings.off;

  return (
    <Card className="space-y-3 p-6">
      <h2 id="cookie-preferences-heading" className="text-lg font-semibold">
        {c.settings.heading}
      </h2>
      <p id="cookie-preferences-description" className="text-sm text-muted-foreground">
        {c.settings.description}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">{statusText}</span>
        <button
          type="button"
          role="switch"
          aria-checked={granted}
          aria-labelledby="cookie-preferences-heading"
          aria-describedby="cookie-preferences-description"
          aria-busy={isUnknown}
          disabled={isUnknown}
          className="min-h-11 min-w-11 rounded-full border border-border px-4 py-2 text-sm disabled:opacity-50"
          onClick={() => setAnalyticsConsent(!granted)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{c.settings.essentialNote}</p>
    </Card>
  );
}
