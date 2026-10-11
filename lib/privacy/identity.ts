import "server-only";
import { cookies } from "next/headers";
import { isAuthApiError, isAuthSessionMissingError, type AuthError, type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ANON_COOKIE_NAME, resolveCurrentUserIds, type CurrentUserIds } from "@/lib/anonymous";

export interface RequestIdentity {
  supabase: Awaited<ReturnType<typeof createClient>>;
  authUser: User | null;
  /** null when the visitor has no account rows. Never creates one. */
  ids: CurrentUserIds | null;
  /** A co_anon cookie was sent, even if it no longer maps to a row (a replayed delete). */
  hasAnonCookie: boolean;
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

// No session, or a credential the auth server rejected (expired, revoked, user gone):
// the caller is not signed in. 429 and 5xx mean the server couldn't answer, so we don't know.
function isNoSession(error: AuthError): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}

async function getAuthUser(supabase: RequestIdentity["supabase"]): Promise<User | null> {
  let result;
  try {
    result = await supabase.auth.getUser();
  } catch (err) {
    throw new AuthUnavailableError(err);
  }
  const { data, error } = result;
  if (error) {
    if (isNoSession(error)) return null;
    throw new AuthUnavailableError(error);
  }
  return data.user ?? null;
}

/** Throws AuthUnavailableError when the auth service fails; no identity is guessed then. */
export async function resolveRequestIdentity(): Promise<RequestIdentity> {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  const ids = await resolveCurrentUserIds(user?.id);
  const hasAnonCookie = Boolean((await cookies()).get(ANON_COOKIE_NAME)?.value);
  return { supabase, authUser: user ?? null, ids, hasAnonCookie };
}

/** Kill switch: DATA_RIGHTS_ENABLED=false makes both data-rights routes return 503. */
export function dataRightsEnabled(): boolean {
  return process.env.DATA_RIGHTS_ENABLED !== "false";
}
