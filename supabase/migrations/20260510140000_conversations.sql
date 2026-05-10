create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  stage text not null default 'onboarding'
    check (stage in ('onboarding','interests','skills','values','constraints','wrap','complete')),
  status text not null default 'active' check (status in ('active','archived','deleted')),
  message_count int not null default 0,
  total_input_tokens int not null default 0,
  total_output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_id_idx on public.conversations(user_id);
create index conversations_status_idx on public.conversations(status);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  safety_flag text,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_created_idx
  on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy conversations_self on public.conversations
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

create policy messages_self on public.messages
  for all using (
    conversation_id in (
      select id from public.conversations
      where user_id in (select id from public.users where auth_id = auth.uid())
    )
  );

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute procedure public.set_updated_at();
