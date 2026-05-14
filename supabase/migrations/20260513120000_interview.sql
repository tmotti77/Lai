-- supabase/migrations/20260513120000_interview.sql

create table interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  persona text not null check (persona in ('hr','technical','first_job')),
  target_occupation_id text,
  target_role_he text not null,
  question_count int not null default 0,
  max_questions int not null default 8,
  completed_at timestamptz,
  feedback_summary_he text,
  feedback_per_question jsonb,
  feedback_strengths_he jsonb,
  feedback_improvements_he jsonb,
  feedback_next_practice_focus_he text,
  forced_wrap boolean not null default false,
  created_at timestamptz not null default now()
);

create index interview_sessions_user_idx on interview_sessions (user_id, created_at desc);

alter table interview_sessions enable row level security;

create policy "interview_sessions_select_own" on interview_sessions
  for select using (
    user_id in (select id from users where auth_id = auth.uid())
  );

create table interview_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references interview_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  safety_flag text,
  cache_read_tokens int,
  cache_write_tokens int,
  created_at timestamptz not null default now()
);

create index interview_messages_session_idx on interview_messages (session_id, created_at);

alter table interview_messages enable row level security;

create policy "interview_messages_select_via_session" on interview_messages
  for select using (
    session_id in (
      select id from interview_sessions
      where user_id in (select id from users where auth_id = auth.uid())
    )
  );
