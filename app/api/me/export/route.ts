import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { track } from "@/lib/analytics";
import { buildAuthOnlyExport, buildUserExport, ExportStorageError, type ExportBundle } from "@/lib/privacy/export";
import { AuthUnavailableError, dataRightsEnabled, resolveRequestIdentity } from "@/lib/privacy/identity";
import { claimExportSlot, EXPORT_COOLDOWN_SECONDS } from "@/lib/privacy/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Deliberately no requireConsent (exception to the "every gated route" rule, #51).
// Access is a data-subject right: a user who revoked consent, or never gave it, can
// still see what we hold. This route never creates an identity either; see
// resolveCurrentUserIds.
export async function GET() {
  if (!dataRightsEnabled()) {
    return NextResponse.json({ error: "disabled" }, { status: 503 });
  }

  try {
    const { authUser, ids } = await resolveRequestIdentity();
    const auth = authUser
      ? {
          email: authUser.email ?? null,
          created_at: authUser.created_at ?? null,
          last_sign_in_at: authUser.last_sign_in_at ?? null,
        }
      : null;

    let bundle: ExportBundle;
    if (ids) {
      if (!(await claimExportSlot(ids.primaryId))) {
        return NextResponse.json(
          { error: "rate_limited", retry_after_s: EXPORT_COOLDOWN_SECONDS },
          { status: 429, headers: { "retry-after": String(EXPORT_COOLDOWN_SECONDS) } },
        );
      }
      bundle = await buildUserExport(ids, auth);
    } else if (auth) {
      // Signed in, but no public rows: export the auth profile without creating any. Not
      // rate limited: there is no row to key the limit on, and this path reads no tables.
      bundle = buildAuthOnlyExport(auth);
    } else {
      return NextResponse.json({ error: "no_identity" }, { status: 401 });
    }
    track("data_exported", { is_anonymous: ids?.isAnonymous ?? false });

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="careeros-export-${bundle.exported_at.slice(0, 10)}.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      Sentry.captureException(err, { tags: { context: "data_export", stage: "identity" } });
      return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
    }
    if (err instanceof ExportStorageError) {
      Sentry.captureException(err, { tags: { context: "data_export", stage: "storage" } });
      return NextResponse.json({ error: "storage_unavailable" }, { status: 500 });
    }
    Sentry.captureException(err, { tags: { context: "data_export" } });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
