"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { he } from "@/lib/i18n/he";
import { useCookieConsent } from "@/lib/cookie-consent/useCookieConsent";
import { setAnalyticsConsent } from "@/lib/cookie-consent/store";

// Shares the same store (lib/cookie-consent/store.ts) as CookieBanner, so toggling here
// fires the same event and hides a mounted banner without a reload. Cookie choice doesn't
// depend on identity or sign-in, so it renders in every /settings view state.
export function CookiePreferences() {
  const status = useCookieConsent();
  const [notPersisted, setNotPersisted] = useState(false);
  const c = he.cookieConsent;
  const granted = status === "granted";
  const isUnknown = status === "unknown";
  const isUnset = isUnknown || status === "unset";

  const statusText = isUnset ? c.settings.unset : granted ? c.settings.on : c.settings.off;

  function handleToggle() {
    const persisted = setAnalyticsConsent(!granted);
    setNotPersisted(!persisted);
  }

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
          aria-label={c.settings.toggleLabel}
          aria-describedby="cookie-preferences-description"
          aria-busy={isUnknown}
          disabled={isUnknown}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:opacity-50"
          )}
        >
          <span
            className={cn(
              "inline-flex h-6 w-11 items-center rounded-full border border-border transition-colors",
              granted ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform",
                granted ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
              )}
            />
          </span>
        </button>
      </div>
      {notPersisted && (
        <p role="status" className="text-xs text-muted-foreground">
          {c.notPersisted}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{c.settings.essentialNote}</p>
    </Card>
  );
}
