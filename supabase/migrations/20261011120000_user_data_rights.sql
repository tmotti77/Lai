-- #51: user data export + hard delete.

-- Export rate limit (atomic guarded UPDATE, same pattern as the nps_* columns).
alter table public.users add column last_export_at timestamptz;

-- Hard delete of one user's rows in one transaction, children before parents.
-- Explicit deletes rather than relying on the cascade from users, so that
-- tests/unit/privacy/coverage.test.ts can verify every registry table is named here,
-- and so the deletion report gets per-table counts.
-- career_profile goes before conversations: matching by user_id covers orphan rows
-- (conversation_id is null), and the on-delete-set-null FK never fires mid-transaction.
create or replace function public.delete_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  n int;
begin
  delete from public.interview_messages
    where session_id in (select id from public.interview_sessions where user_id = p_user_id);
  get diagnostics n = row_count; r := r || jsonb_build_object('interview_messages', n);

  delete from public.interview_sessions where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('interview_sessions', n);

  delete from public.feedback where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('feedback', n);

  delete from public.cv_uploads where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('cv_uploads', n);

  delete from public.plan_tasks
    where plan_id in (select id from public.plans where user_id = p_user_id);
  get diagnostics n = row_count; r := r || jsonb_build_object('plan_tasks', n);

  delete from public.plans where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('plans', n);

  delete from public.recommendations where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('recommendations', n);

  delete from public.career_profile where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('career_profile', n);

  delete from public.assessments where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('assessments', n);

  delete from public.messages
    where conversation_id in (select id from public.conversations where user_id = p_user_id);
  get diagnostics n = row_count; r := r || jsonb_build_object('messages', n);

  delete from public.conversations where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('conversations', n);

  delete from public.consents where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('consents', n);

  delete from public.anonymous_sessions where user_id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('anonymous_sessions', n);

  delete from public.users where id = p_user_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('users', n);

  return r;
end;
$$;

-- SECURITY DEFINER bypasses RLS: only our server (service role) may call it.
revoke execute on function public.delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_data(uuid) to service_role;
