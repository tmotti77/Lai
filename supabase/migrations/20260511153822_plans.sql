create type public.plan_archetype as enum ('apply', 'taste_test', 'research');

create type public.plan_task_category as enum ('action', 'research', 'network', 'reflection');

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  archetype public.plan_archetype not null,
  generated_at timestamptz not null default now()
);

create index plans_user_generated_idx on public.plans(user_id, generated_at desc);
create index plans_recommendation_idx on public.plans(recommendation_id);

create table public.plan_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  day int not null check (day between 1 and 30),
  title_he text not null,
  description_he text not null,
  category public.plan_task_category not null,
  estimated_minutes int not null check (estimated_minutes > 0 and estimated_minutes <= 480),
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index plan_tasks_plan_day_idx on public.plan_tasks(plan_id, day);
create index plan_tasks_plan_done_idx on public.plan_tasks(plan_id, done);

alter table public.plans enable row level security;
alter table public.plan_tasks enable row level security;

create policy plans_self on public.plans
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

create policy plan_tasks_self on public.plan_tasks
  for all using (
    plan_id in (
      select id from public.plans p
      where p.user_id in (select id from public.users where auth_id = auth.uid())
    )
  );
