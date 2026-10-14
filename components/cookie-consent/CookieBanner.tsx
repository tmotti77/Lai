"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import { useCookieConsent } from "@/lib/cookie-consent/useCookieConsent";
import { setAnalyticsConsent } from "@/lib/cookie-consent/store";

// Non-modal, normal-flow banner (decisions 6-7): no position: fixed, no z-index, no
// overlay, so it never covers the composer/save bar on any surface and needs no
// ResizeObserver height-publishing. Renders only while the choice is "unset" (decision 3:
// default deny). No autofocus/focus trap — it must never steal focus from the chat input.
export function CookieBanner() {
  const status = useCookieConsent();
  if (status !== "unset") return null;

  return (
    <section
      role="region"
      aria-labelledby="cookie-banner-title"
      dir="rtl"
      className="border-t bg-background/95 px-4 py-4 text-sm"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <h2 id="cookie-banner-title" className="font-medium">
            {he.cookieConsent.title}
          </h2>
          <p className="mt-1 text-muted-foreground">
            {he.cookieConsent.body}{" "}
            <Link href="/privacy" className="inline-flex min-h-11 items-center underline">
              {he.cookieConsent.privacyLink}
            </Link>{" "}
            <Link href="/settings" className="inline-flex min-h-11 items-center underline">
              {he.cookieConsent.settingsLink}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 min-w-11"
            onClick={() => setAnalyticsConsent(false)}
          >
            {he.cookieConsent.essentialOnly}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 min-w-11"
            onClick={() => setAnalyticsConsent(true)}
          >
            {he.cookieConsent.acceptAnalytics}
          </Button>
        </div>
      </div>
    </section>
  );
}
