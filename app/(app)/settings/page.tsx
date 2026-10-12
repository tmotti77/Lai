import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { DataRightsPanel } from "@/components/settings/DataRightsPanel";
import { he } from "@/lib/i18n/he";
import {
  dataRightsEnabled,
  resolveRequestIdentity,
  SessionRejectedError,
} from "@/lib/privacy/identity";

export const dynamic = "force-dynamic";
export const metadata = { title: he.settings.title };

type View =
  | { kind: "disabled" }
  | { kind: "sessionExpired" }
  | { kind: "loadError" }
  | { kind: "noData" }
  | { kind: "panel"; isAnonymous: boolean };

// Deliberately no getOrCreateAnonymousUserId and no requireConsent (#51): like the
// data-rights routes, this page never creates an identity and doesn't depend on consent.
// The proxy preserves a rejected session here (lib/supabase/middleware.ts), so it surfaces
// as SessionRejectedError instead of silently falling back to the anonymous footprint.
async function resolveView(): Promise<View> {
  if (!dataRightsEnabled()) return { kind: "disabled" };
  try {
    const { authUser, ids } = await resolveRequestIdentity();
    if (!ids && !authUser) return { kind: "noData" };
    // ids is null for an auth-only account, which is still signed in.
    return { kind: "panel", isAnonymous: ids?.isAnonymous ?? false };
  } catch (err) {
    if (err instanceof SessionRejectedError) return { kind: "sessionExpired" };
    Sentry.captureException(err, { tags: { context: "settings_page" } });
    return { kind: "loadError" };
  }
}

export default async function SettingsPage() {
  const s = he.settings;
  const view = await resolveView();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{s.title}</h1>
        <p className="text-base text-muted-foreground">{s.intro}</p>
      </header>

      {view.kind === "disabled" && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
          <p>{s.disabled}</p>
          <p>
            <a href={`mailto:${he.privacy.contactEmail}`} dir="ltr" className="underline underline-offset-4">
              {he.privacy.contactEmail}
            </a>
          </p>
        </div>
      )}
      {view.kind === "sessionExpired" && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-4 text-sm">
          <p>{s.sessionExpired}</p>
          <Button asChild size="sm">
            <Link href="/sign-in">{s.signInAgain}</Link>
          </Button>
        </div>
      )}
      {view.kind === "loadError" && (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {s.loadError}
        </p>
      )}
      {view.kind === "noData" && <p className="rounded-md border bg-muted/30 p-4 text-sm">{s.noData}</p>}
      {view.kind === "panel" && <DataRightsPanel isAnonymous={view.isAnonymous} />}

      <p className="text-sm">
        <Link href="/privacy" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
          {s.privacyLink}
        </Link>
      </p>
    </div>
  );
}
