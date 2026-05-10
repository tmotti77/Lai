-- Skills taxonomy
create table public.skills (
  id text primary key,
  name_he text not null,
  category text not null
    check (category in ('technical','soft','analytical','creative','social','managerial','language','physical')),
  related_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Occupations
create table public.occupations (
  id text primary key,
  title_he text not null,
  title_en text not null,
  description_he text not null,
  riasec_affinity jsonb not null,
  required_skills jsonb not null,
  desired_skills jsonb not null,
  values_fit text[] not null default '{}',
  big5_fit jsonb,
  constraints jsonb not null,
  market jsonb not null,
  data_source text not null,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index occupations_demand_idx on public.occupations((market->>'demand_he'));

create trigger occupations_set_updated_at
  before update on public.occupations
  for each row execute procedure public.set_updated_at();

-- Catalog version: bumps when seed script reseeds. Recommendations cache
-- includes this in profile_hash so a catalog change invalidates old recs.
create table public.catalog_version (
  id int primary key default 1 check (id = 1),
  version int not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.catalog_version (id, version) values (1, 1);

-- Generated recommendations cache
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  profile_hash text not null,
  rankings jsonb not null,
  paths jsonb not null,
  prose jsonb not null,
  generated_at timestamptz not null default now()
);

create index recommendations_user_generated_idx
  on public.recommendations(user_id, generated_at desc);
create index recommendations_user_hash_idx
  on public.recommendations(user_id, profile_hash);

alter table public.skills enable row level security;
alter table public.occupations enable row level security;
alter table public.catalog_version enable row level security;
alter table public.recommendations enable row level security;

-- Skills + occupations + catalog_version are public-read (everyone sees the catalog).
create policy skills_read_all on public.skills for select using (true);
create policy occupations_read_all on public.occupations for select using (true);
create policy catalog_version_read_all on public.catalog_version for select using (true);

-- Recommendations: per-user. Service role bypasses (used by API route).
create policy recommendations_self on public.recommendations
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );
