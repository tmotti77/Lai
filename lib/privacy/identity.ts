import "server-only";
import { cookies } from "next/headers";
import { isAuthApiError, isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ANON_COOKIE_NAME, resolveCurrentUserIds, type CurrentUserIds } from "@/lib/anonymous";

export interface RequestIdentity {
  supabase: Awaited<ReturnType<typeof createClient>>;
  authUser: User | null;
  /** null when the visitor has no account rows. Never creates one. */
  ids: CurrentUserIds | null;
  /** A co_anon cookie was sent, even if it no longer maps to a row (a replayed delete). */
  hasAnonCookie: boolean;
  /** The session belongs to an auth user that no longer exists (a replayed delete). */
  authAccountGone: boolean;
}

/**
 * The auth service could not tell us who the caller is. Distinct from "no session":
 * treating it as anonymous would let a signed-in user's delete succeed against only
 * their cookie footprint, or not at all, while their account stays.
 */
export class AuthUnavailableError extends Error {
  constructor(cause: unknown) {
    super("auth service unavailable", { cause });
    this.name = "AuthUnavailableError";
  }
}

/**
 * The caller sent a session the auth server rejected (expired, revoked, bad JWT). They
 * meant to act as a signed-in user, so falling back to their anonymous cookie would
 * export or delete the wrong, smaller footprint: they must sign in again.
 */
export class SessionRejectedError extends Error {
  constructor(public code: string) {
    super(`auth session rejected: ${code}`);
    this.name = "SessionRejectedError";
  }
}

// Classified by code, not status: a 4xx without one of these codes (e.g. 401 "Invalid API
// key") is our configuration failing, not the caller being signed out.
const REJECTED_SESSION_CODES = new Set([
  "session_not_found",
  "session_expired",
  "bad_jwt",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "no_authorization",
]);

async function getAuthUser(
  supabase: RequestIdentity["supabase"],
): Promise<{ user: User | null; accountGone: boolean }> {
  let result;
  try {
    result = await supabase.auth.getUser();
  } catch (err) {
    throw new AuthUnavailableError(err);
  }
  const { data, error } = result;
  if (!error) return { user: data.user ?? null, accountGone: false };
  if (isAuthSessionMissingError(error)) return { user: null, accountGone: false };
  if (isAuthApiError(error) && error.code === "user_not_found") return { user: null, accountGone: true };
  if (isAuthApiError(error) && error.code && REJECTED_SESSION_CODES.has(error.code)) {
    throw new SessionRejectedError(error.code);
  }
  throw new AuthUnavailableError(error);
}

/**
 * Throws AuthUnavailableError when the auth service fails and SessionRejectedError when the
 * caller's session is no good; no identity is guessed in either case.
 */
export async function resolveRequestIdentity(): Promise<RequestIdentity> {
  const supabase = await createClient();
  const { user, accountGone } = await getAuthUser(supabase);
  const ids = await resolveCurrentUserIds(user?.id);
  const hasAnonCookie = Boolean((await cookies()).get(ANON_COOKIE_NAME)?.value);
  return { supabase, authUser: user, ids, hasAnonCookie, authAccountGone: accountGone };
}

/** Kill switch: DATA_RIGHTS_ENABLED=false makes both data-rights routes return 503. */
export function dataRightsEnabled(): boolean {
  return process.env.DATA_RIGHTS_ENABLED !== "false";
}
