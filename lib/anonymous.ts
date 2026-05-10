import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const ANON_COOKIE_NAME = "co_anon";
const ANON_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function generateAnonymousToken(): string {
  return randomBytes(24).toString("base64url");
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
    const { data } = await svc
      .from("users")
      .select("id")
      .eq("auth_id", authedUserId)
      .maybeSingle();
    if (data) return data.id;
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

  cookieStore.set(ANON_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ANON_COOKIE_MAX_AGE_SECONDS,
  });

  return newUser.id;
}
