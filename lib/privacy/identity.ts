import "server-only";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
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

export async function resolveRequestIdentity(): Promise<RequestIdentity> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ids = await resolveCurrentUserIds(user?.id);
  const hasAnonCookie = Boolean((await cookies()).get(ANON_COOKIE_NAME)?.value);
  return { supabase, authUser: user ?? null, ids, hasAnonCookie };
}

/** Kill switch: DATA_RIGHTS_ENABLED=false makes both data-rights routes return 503. */
export function dataRightsEnabled(): boolean {
  return process.env.DATA_RIGHTS_ENABLED !== "false";
}
