create type public.assessment_type as enum ('riasec', 'big5', 'values', 'constraints');

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type public.assessment_type not null,
  responses jsonb not null,
  scores jsonb not null,
  items_version int not null,
  taken_at timestamptz not null default now()
);

create index assessments_user_type_taken_at_idx
  on public.assessments(user_id, type, taken_at desc);

alter table public.assessments enable row level security;

-- Authenticated users see their own assessments. Anonymous users access via the
-- server's service-role client (same pattern as career_profile in Phase 2 — the
-- chat/assessment routes resolve user_id server-side and bypass RLS).
create policy assessments_self on public.assessments
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );
