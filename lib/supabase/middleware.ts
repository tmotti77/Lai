import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { ANON_COOKIE_NAME, ensureAnonymousCookie } from "@/lib/anonymous";

/** GET /api/me/export and DELETE /api/me. */
export function isDataRightsPath(pathname: string): boolean {
  return pathname === "/api/me" || pathname.startsWith("/api/me/");
}

export async function updateSession(request: NextRequest) {
  // The data-rights routes resolve identity themselves, read-only (#51). Refreshing here
  // would clear a rejected session's cookies, so the route would see "no session" and fall
  // back to co_anon, deleting the wrong identity. Leave auth untouched so it fails closed
  // (401), and never mint an anonymous user for an export or delete.
  if (isDataRightsPath(request.nextUrl.pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

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
