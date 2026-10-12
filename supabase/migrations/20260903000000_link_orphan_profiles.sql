-- Migration: Link orphan career_profile rows to the user's latest conversation
--
-- Background: anonymous users who uploaded CVs have career_profile rows with conversation_id = NULL
-- ("orphans"). The recommendations loader reads the latest-conversation row plus the user's most
-- recently updated row, so an orphan that isn't the newest row is invisible to matching.
--
-- v2 (never applied anywhere; the first prod attempt failed atomically with 23505):
-- the original UPDATE linked EVERY orphan to the latest conversation and violated
-- unique (user_id, conversation_id) when the user already had a row there, or had 2+ orphans.
--
-- Rules:
--  * Per user with >=1 conversation, target T = latest conversation (updated_at desc, id desc).
--  * Link ONE orphan (newest, updated_at desc, id desc) to T, and only if the user has no row at T.
--  * Every other orphan is left in place untouched (no data merged, nothing deleted). Merging
--    JSON profiles changes what matching sees; see docs/plans/link-orphan-profiles-dup*.md.
--  * updated_at is preserved (trigger disabled for this transaction) so linking does not change
--    which row the loader treats as "latest".
--  * Idempotent: a re-run finds the row at T and does nothing.
--  * MUST run as ONE transaction (db push / apply_migration do). Do not split it: a mid-failure
--    outside a transaction could leave career_profile_set_updated_at disabled.
--  * Local-only verification: scripts/db-verify/run-link-orphans.sh (not in CI).
--  * Prod records apply-time versions (applied via the Supabase apply_migration tool), so the
--    old 20260903 file timestamp does not block applying; with `supabase db push` use --include-all.

lock table public.career_profile in share row exclusive mode;

alter table public.career_profile disable trigger career_profile_set_updated_at;

with targets as (
  select distinct on (c.user_id) c.user_id, c.id as conversation_id
  from public.conversations c
  order by c.user_id, c.updated_at desc, c.id desc
),
candidates as (
  select distinct on (cp.user_id) cp.id, t.conversation_id
  from public.career_profile cp
  join targets t on t.user_id = cp.user_id
  where cp.conversation_id is null
    and not exists (
      select 1 from public.career_profile x
      where x.user_id = cp.user_id and x.conversation_id = t.conversation_id
    )
  order by cp.user_id, cp.updated_at desc, cp.id desc
)
update public.career_profile cp
set conversation_id = candidates.conversation_id
from candidates
where cp.id = candidates.id;

alter table public.career_profile enable trigger career_profile_set_updated_at;
