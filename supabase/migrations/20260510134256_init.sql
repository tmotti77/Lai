-- Users table mirrors auth.users but adds career-specific fields and anonymous support.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete cascade, -- nullable for anonymous
  is_anonymous boolean not null default true,
  display_name text,
  email text,
  age_range text check (age_range in ('18-24','25-34','35-44','45-54','55+')),
  career_stage text,
  current_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deletion_requested_at timestamptz
);

create index users_auth_id_idx on public.users(auth_id);
create index users_email_idx on public.users(email);

-- Anonymous sessions: a cookie-based token that maps to a public.users row before sign-up.
create table public.anonymous_sessions (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index anonymous_sessions_user_id_idx on public.anonymous_sessions(user_id);
create index anonymous_sessions_expires_at_idx on public.anonymous_sessions(expires_at);

-- Consents: each granular consent is a row. New version => new row, never update.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purpose text not null check (purpose in ('processing','disclaimer','marketing','training_data')),
  version text not null,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip_address inet,
  user_agent text
);

create index consents_user_id_idx on public.consents(user_id);

-- Enable Row Level Security on all tables.
alter table public.users enable row level security;
alter table public.anonymous_sessions enable row level security;
alter table public.consents enable row level security;

-- Policies: users can read/update their own row. Anonymous sessions are server-only.
create policy users_self_select on public.users
  for select using (auth.uid() = auth_id);

create policy users_self_update on public.users
  for update using (auth.uid() = auth_id);

create policy consents_self_select on public.consents
  for select using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

-- Anonymous-session writes always come via service role; no user-facing policy needed.

-- Updated-at trigger.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute procedure public.set_updated_at();
