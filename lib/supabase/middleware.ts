import "server-only";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { ANON_COOKIE_NAME, ensureAnonymousCookie } from "@/lib/anonymous";

/** GET /api/me/export and DELETE /api/me. */
export function isDataRightsPath(pathname: string): boolean {
  return pathname === "/api/me" || pathname.startsWith("/api/me/");
}

/**
 * /settings offers export and delete, so it must see a rejected session as rejected, not
 * as "signed out" (which would show the anonymous footprint; #51 part 2 critique #1).
 */
export function isDataRightsPage(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export async function updateSession(request: NextRequest) {
  // The data-rights routes resolve identity themselves, read-only (#51). Refreshing here
  // would clear a rejected session's cookies, so the route would see "no session" and fall
  // back to co_anon, deleting the wrong identity. Leave auth untouched so it fails closed
  // (401), and never mint an anonymous user for an export or delete.
  // An expired access token is still refreshed: getUser() in the route handler refreshes
  // it (and may write cookies there); a failed refresh surfaces as a coded AuthApiError.
  if (isDataRightsPath(request.nextUrl.pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const applyCookies = (cookiesToSet: Parameters<SetAllCookies>[0]) => {
    cookiesToSet.forEach(({ name, value }) =>
      request.cookies.set(name, value),
    );
    response = NextResponse.next({ request });
    cookiesToSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    );
  };

  const preserveIdentity = isDataRightsPage(request.nextUrl.pathname);
  const buffered: Parameters<SetAllCookies>[0] = [];

  const supabase = createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          if (preserveIdentity) buffered.push(...cookiesToSet);
          else applyCookies(cookiesToSet);
        },
      },
    },
  );

  if (preserveIdentity) {
    // Still refresh here: a valid but expired session must be written by the proxy, since
    // the page (an RSC) can't write cookies. But when the auth server rejects the session,
    // supabase-js clears its cookies; drop that write so the page sees the rejected session
    // and asks for sign-in again. Like /api/me*, never mint an anonymous user here.
    let error: unknown = null;
    try {
      ({ error } = await supabase.auth.getUser());
    } catch (err) {
      error = err;
    }
    if (!error || isAuthSessionMissingError(error)) applyCookies(buffered);
    return response;
  }

  await supabase.auth.getUser();

  // Bootstrap anonymous cookie so server components never need to write one.
  // Next.js 16 forbids cookie writes from Server Components; we do it here in
  // middleware where it's allowed, before the server component runs.
  const existing = request.cookies.get(ANON_COOKIE_NAME)?.value;
  const bootstrap = await ensureAnonymousCookie(existing);
  if (bootstrap) {
    request.cookies.set(bootstrap.name, bootstrap.value);
    response.cookies.set(bootstrap.name, bootstrap.value, bootstrap.options);
  }

  return response;
}
