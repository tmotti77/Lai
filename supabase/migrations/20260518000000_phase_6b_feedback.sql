-- supabase/migrations/20260518000000_phase_6b_feedback.sql
-- Phase 6b: feedback table for thumbs + NPS; users columns for NPS state machine.

create table public.feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  surface       text not null check (surface in ('chat', 'recommendations', 'interview', 'nps')),
  target_type   text check (target_type is null or target_type in (
                  'message', 'recommendation_occupation', 'interview_session'
                )),
  target_id     text,
  thumbs_value  smallint check (thumbs_value in (-1, 1)),
  nps_score     smallint check (nps_score between 0 and 10),
  nps_trigger   text check (nps_trigger is null or nps_trigger in (
                  'pdf_download', 'plan_generated', 'interview_completed'
                )),
  comment_he    text check (comment_he is null or char_length(comment_he) <= 1000),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint feedback_exactly_one_signal check (
    (thumbs_value is not null and nps_score is null) or
    (thumbs_value is null and nps_score is not null)
  ),
  constraint feedback_thumb_has_target check (
    (thumbs_value is null) or (target_type is not null and target_id is not null)
  ),
  constraint feedback_nps_has_trigger check (
    (nps_score is null) or (nps_trigger is not null)
  ),
  constraint feedback_nps_shape check (
    (nps_score is null) or
    (surface = 'nps' and target_type is null and target_id is null)
  ),
  constraint feedback_thumb_shape check (
    (thumbs_value is null) or (nps_trigger is null)
  ),
  constraint feedback_thumb_no_comment check (
    (thumbs_value is null) or (comment_he is null)
  ),
  constraint feedback_target_id_length check (
    target_id is null or char_length(target_id) <= 128
  ),
  constraint feedback_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index feedback_one_thumb_per_target_idx
  on public.feedback (user_id, surface, target_type, target_id)
  where thumbs_value is not null;

create unique index feedback_one_nps_per_user_idx
  on public.feedback (user_id)
  where nps_score is not null;

create index feedback_surface_created_at_idx
  on public.feedback (surface, created_at desc);

create index feedback_nps_trigger_created_at_idx
  on public.feedback (nps_trigger, created_at desc)
  where nps_score is not null;

create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function public.set_updated_at();

alter table public.feedback enable row level security;
-- No policies → service-role-only access. Anonymous users have auth_id IS NULL
-- so any owner-select policy would never match anyway.

alter table public.users
  add column nps_eligibility_first_at  timestamptz,
  add column nps_submitted_at          timestamptz,
  add column nps_dismissed_at          timestamptz,
  add column nps_trigger_first         text check (
    nps_trigger_first is null or nps_trigger_first in (
      'pdf_download', 'plan_generated', 'interview_completed'
    )
  ),
  add column first_report_downloaded_at timestamptz;
