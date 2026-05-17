-- Tighten SECURITY DEFINER function privileges. Anon/authenticated
-- clients (using the publishable key) must NOT be able to call these
-- directly — they bypass RLS by design. Service-role callers
-- (our server code) keep access; everything else is locked out.

-- merge_career_profile: writes to public.career_profile
revoke execute on function public.merge_career_profile(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.merge_career_profile(uuid, uuid, text, jsonb)
  to service_role;

-- increment_conversation_counters: writes token usage onto conversations
revoke execute on function public.increment_conversation_counters(uuid, int, int)
  from public, anon, authenticated;

grant execute on function public.increment_conversation_counters(uuid, int, int)
  to service_role;
