import "server-only";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";

export const ANON_COOKIE_NAME = "co_anon";
const ANON_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function generateAnonymousToken(): string {
  // Web Crypto — works in both Node.js and Edge runtimes (the middleware that
  // bootstraps this cookie can run in either).
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // base64url encoding (URL-safe, no padding) — matches the prior
  // node:crypto randomBytes().toString("base64url") output shape.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Returns the public.users.id for the current visitor.
 * - If they're authenticated, returns their user row id.
 * - If they have a co_anon cookie that maps to a row, returns that row id.
 * - Otherwise, creates a new anonymous user + session, sets the cookie, returns the new id.
 */
export async function getOrCreateAnonymousUserId(authedUserId?: string): Promise<string> {
  const cookieStore = await cookies();
  const svc = createServiceClient();

  if (authedUserId) {
    // Already-promoted: this auth_id has its own users row.
    const { data: existing } = await svc
      .from("users")
      .select("id")
      .eq("auth_id", authedUserId)
      .maybeSingle();
    if (existing) return existing.id;

    // First-time sign-in: if a co_anon cookie points at an existing anonymous
    // users row, PROMOTE it in place so all the user's pre-signup conversations,
    // consents, and assessments stay attached. Otherwise they'd be orphaned.
    const anonToken = cookieStore.get(ANON_COOKIE_NAME)?.value;
    if (anonToken) {
      const { data: anonSession } = await svc
        .from("anonymous_sessions")
        .select("user_id")
        .eq("token", anonToken)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (anonSession) {
        const { data: promoted } = await svc
          .from("users")
          .update({ auth_id: authedUserId, is_anonymous: false })
          .eq("id", anonSession.user_id)
          .eq("is_anonymous", true)
          .select("id")
          .maybeSingle();
        if (promoted) {
          // Clean up the anonymous session so the cookie is no longer the source of truth.
          await svc.from("anonymous_sessions").delete().eq("token", anonToken);
          try {
            cookieStore.delete(ANON_COOKIE_NAME);
          } catch {
            // Server Components can't write cookies in Next.js 16. The stale
            // cookie is harmless — it points at a now-deleted anonymous_sessions
            // row, so the next request returns the promoted users row anyway.
          }
          return promoted.id;
        }
      }
    }

    // Fresh authed user with no prior anonymous footprint.
    const { data: created } = await svc
      .from("users")
      .insert({ auth_id: authedUserId, is_anonymous: false })
      .select("id")
      .single();
    if (!created) throw new Error("Failed to create authed user row");
    return created.id;
  }

  const existing = cookieStore.get(ANON_COOKIE_NAME)?.value;
  if (existing) {
    const { data } = await svc
      .from("anonymous_sessions")
      .select("user_id")
      .eq("token", existing)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (data) return data.user_id;
  }

  const { data: newUser, error: userErr } = await svc
    .from("users")
    .insert({ is_anonymous: true })
    .select("id")
    .single();
  if (userErr || !newUser) throw new Error("Failed to create anonymous user");

  const token = generateAnonymousToken();
  await svc.from("anonymous_sessions").insert({ token, user_id: newUser.id });

  try {
    cookieStore.set(ANON_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ANON_COOKIE_MAX_AGE_SECONDS,
    });
  } catch {
    // Server Components can't write cookies in Next.js 16. Middleware
    // (`ensureAnonymousCookie` below) should have set it before we got
    // here; if it didn't, this request creates an orphan user row but
    // the next request will go through middleware and set up properly.
  }

  return newUser.id;
}

export interface CurrentUserIds {
  /** users.id to act on. */
  primaryId: string;
  /** auth.users.id, null for anonymous visitors. */
  authId: string | null;
  isAnonymous: boolean;
  /** An unpromoted anonymous row this browser's co_anon cookie still proves ownership of. */
  linkedAnonymousId: string | null;
}

/**
 * Read-only counterpart of getOrCreateAnonymousUserId for the data-rights routes (#51):
 * exporting or deleting must never create or promote an account. Returns null when the
 * visitor has no identity.
 *
 * A cookie only ever resolves to a row that is still anonymous. Unlike chat, these routes
 * hand out or destroy a whole account, so a stale cookie for a promoted row grants nothing.
 */
export async function resolveCurrentUserIds(authedUserId?: string): Promise<CurrentUserIds | null> {
  const cookieStore = await cookies();
  const svc = createServiceClient();

  const anonToken = cookieStore.get(ANON_COOKIE_NAME)?.value;
  let anonUserId: string | null = null;
  if (anonToken) {
    const { data: session, error } = await svc
      .from("anonymous_sessions")
      .select("user_id")
      .eq("token", anonToken)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(`resolveCurrentUserIds: ${error.message}`);
    if (session) {
      const { data: anonRow, error: rowErr } = await svc
        .from("users")
        .select("id")
        .eq("id", session.user_id)
        .eq("is_anonymous", true)
        .maybeSingle();
      if (rowErr) throw new Error(`resolveCurrentUserIds: ${rowErr.message}`);
      anonUserId = anonRow?.id ?? null;
    }
  }

  if (!authedUserId) {
    return anonUserId
      ? { primaryId: anonUserId, authId: null, isAnonymous: true, linkedAnonymousId: null }
      : null;
  }

  const { data: own, error } = await svc
    .from("users")
    .select("id")
    .eq("auth_id", authedUserId)
    .maybeSingle();
  if (error) throw new Error(`resolveCurrentUserIds: ${error.message}`);
  if (own) {
    return {
      primaryId: own.id,
      authId: authedUserId,
      isAnonymous: false,
      linkedAnonymousId: anonUserId && anonUserId !== own.id ? anonUserId : null,
    };
  }
  // Signed in but never promoted: the anon row is the one getOrCreateAnonymousUserId
  // would promote, so it is this person's account.
  if (anonUserId) {
    return { primaryId: anonUserId, authId: authedUserId, isAnonymous: false, linkedAnonymousId: null };
  }
  return null;
}

/**
 * Bootstraps the anonymous cookie from middleware so Server Components
 * never have to write cookies (which Next.js 16 forbids). Idempotent —
 * does nothing if the request already has a `co_anon` cookie.
 *
 * Returns the cookie pair to apply on the response, or null if no
 * bootstrap was needed.
 */
export async function ensureAnonymousCookie(existingToken: string | undefined): Promise<{
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: true;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
} | null> {
  if (existingToken) return null;

  const svc = createServiceClient();
  const { data: newUser, error: userErr } = await svc
    .from("users")
    .insert({ is_anonymous: true })
    .select("id")
    .single();
  if (userErr || !newUser) {
    console.error("[anonymous] middleware bootstrap failed to create user", userErr);
    return null;
  }

  const token = generateAnonymousToken();
  const { error: sessErr } = await svc
    .from("anonymous_sessions")
    .insert({ token, user_id: newUser.id });
  if (sessErr) {
    console.error("[anonymous] middleware bootstrap failed to create session", sessErr);
    return null;
  }

  return {
    name: ANON_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ANON_COOKIE_MAX_AGE_SECONDS,
    },
  };
}
