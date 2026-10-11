import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { track } from "@/lib/analytics";
import { ANON_COOKIE_NAME } from "@/lib/anonymous";
import { serverEnv } from "@/lib/env";
import {
  DeleteRequestBody,
  DeletionInProgressError,
  DeletionStageError,
  deleteUserData,
} from "@/lib/privacy/delete";
import { AuthUnavailableError, dataRightsEnabled, resolveRequestIdentity } from "@/lib/privacy/identity";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Defence in depth: a JSON body on DELETE already forces a CORS preflight, and our
// cookies are sameSite=lax. Requests without an Origin header are not from a browser form.
function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === req.nextUrl.origin || origin === new URL(serverEnv.NEXT_PUBLIC_SITE_URL).origin;
}

// Deliberately no requireConsent (exception to the "every mutation route" rule, #51).
// Erasure is the user withdrawing everything; it can't be conditional on having given
// processing consent. Identity is resolved read-only, so deleting never creates an account.
export async function DELETE(req: NextRequest) {
  if (!dataRightsEnabled()) {
    return NextResponse.json({ error: "disabled" }, { status: 503 });
  }
  if (!originAllowed(req)) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }
  try {
    DeleteRequestBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  let identity;
  try {
    identity = await resolveRequestIdentity();
  } catch (err) {
    Sentry.captureException(err, { tags: { context: "account_delete", stage: "identity" } });
    // Never fall back to the cookie identity here: we'd delete less than the caller's account.
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json({ error: "auth_unavailable", retryable: true }, { status: 503 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  const { supabase, authUser, ids, hasAnonCookie } = identity;

  // A credential with nothing left behind it is a replay or a retry: succeed with zero
  // counts. Only a request with no credential at all is unauthenticated.
  if (!ids && !authUser && !hasAnonCookie) {
    return NextResponse.json({ error: "no_identity" }, { status: 401 });
  }

  try {
    const report = await deleteUserData({
      primaryId: ids?.primaryId ?? null,
      authId: authUser?.id ?? null,
      linkedAnonymousId: ids?.linkedAnonymousId ?? null,
    });
    track("account_deleted", {
      is_anonymous: ids?.isAnonymous ?? !authUser,
      had_auth_user: report.auth_user === "deleted",
    });

    // complete=false: the account and rows are gone but some storage objects may remain.
    // A retry can't reach them any more (nothing resolves to this user), so this is not a
    // retryable 5xx; it is logged to Sentry for manual cleanup, with the bucket lifecycle as backstop.
    const res = NextResponse.json({ deleted: true, complete: report.storage_cleanup === "complete", report });
    res.cookies.delete(ANON_COOKIE_NAME);
    if (authUser) {
      // The auth user is gone; drop the browser's now-dangling session cookies too.
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) console.warn("[privacy] signOut after delete failed", error.message);
    }
    return res;
  } catch (err) {
    if (err instanceof DeletionInProgressError) {
      return NextResponse.json(
        { error: "deletion_in_progress", retry_after_s: err.retryAfterSeconds },
        { status: 409, headers: { "retry-after": String(err.retryAfterSeconds) } },
      );
    }
    if (err instanceof DeletionStageError) {
      const res = NextResponse.json(
        { error: "deletion_incomplete", stage: err.stage, retryable: true },
        { status: 500 },
      );
      // After an auth-stage failure the public data is gone, so the anon cookie is dead.
      // The Supabase session is kept on purpose: it is what the retry authenticates with.
      if (err.stage === "auth") res.cookies.delete(ANON_COOKIE_NAME);
      return res;
    }
    Sentry.captureException(err, { tags: { context: "account_delete" } });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
