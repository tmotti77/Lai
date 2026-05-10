create table public.career_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  current_stage text not null default 'onboarding'
    check (current_stage in ('onboarding','interests','skills','values','constraints','wrap','complete')),
  data jsonb not null default '{}'::jsonb,
  extraction_count int not null default 0,
  last_extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, conversation_id)
);

create index career_profile_user_id_idx on public.career_profile(user_id);
create index career_profile_conversation_id_idx on public.career_profile(conversation_id);

alter table public.career_profile enable row level security;

create policy career_profile_self on public.career_profile
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

create trigger career_profile_set_updated_at
  before update on public.career_profile
  for each row execute procedure public.set_updated_at();

create or replace function public.merge_career_profile(
  p_user_id uuid,
  p_conversation_id uuid,
  p_stage text,
  p_data jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.career_profile (user_id, conversation_id, current_stage, data, extraction_count, last_extracted_at)
  values (p_user_id, p_conversation_id, p_stage, p_data, 1, now())
  on conflict (user_id, conversation_id) do update
  set
    current_stage = p_stage,
    data = public.career_profile.data || p_data,
    extraction_count = public.career_profile.extraction_count + 1,
    last_extracted_at = now(),
    updated_at = now();
end;
$$;
