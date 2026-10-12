# Plan: make `link_orphan_profiles` safe against (user_id, conversation_id) duplicates

## Problem
Applying `supabase/migrations/20260903000000_link_orphan_profiles.sql` on prod failed with 23505
(`career_profile_user_id_conversation_id_key`). Example: orphan career_profile `94eecdee-…` (conversation_id NULL)
of user `daa13ae3-…`, who already has a row for their latest conversation `0ede539c-…`. The UPDATE sets the orphan's
conversation_id to that same conversation → unique violation. Same failure if a user has **two or more** orphans
and no linked row (NULLs don't collide under the unique constraint, but they all get the same latest conversation).
Prod state: `list_migrations` (read-only) shows the migration is **not applied** (whole migration rolled back). Nothing changed in prod.

## Loader check (decides skip vs merge)
- `app/api/recommendations/route.ts` loads the row for the latest conversation **plus the single most-recently-updated row**
  of the user, and merges those two (skills union by id; conversation row wins for other keys).
- `app/api/cv/confirm/route.ts` reads the latest-conversation row, else the latest-updated row.
- An orphan is therefore only visible when it is the user's most recently updated row. A conflicting orphan that is
  not the newest is **invisible** → "skip and leave in place" would keep its data (e.g. CV skills) out of matching,
  which is exactly the bug this migration exists to fix. **Skip is not safe → merge.**

## Approach (edit the unapplied migration in place)
The file has never been applied in prod (not in `list_migrations`) and failed atomically, so editing it is safe and
keeps one migration with one meaning. (Repo timestamp 20260903 < 20261011; prod records apply-time versions, so order
on apply is by name in the CLI and is unaffected.) One transaction, three steps, per user with ≥1 conversation,
target T = user's latest conversation (updated_at desc, id desc as tiebreak):
1. **Link**: if the user has no row at T, link the user's most recently updated orphan to T (exactly one per user).
2. **Merge**: for every remaining orphan of a user who now has a row at T, merge into the T row:
   `data = orphan.data || T.data` (T wins on key clashes, mirroring the loader), `skills` = union by `id`
   (T first, same as the loader), and append the orphan's full snapshot
   `{id, data, current_stage, extraction_count, created_at, updated_at}` to `data.merged_orphan_profiles`
   (only if that id is not already there) → no data is lost, provenance kept, stays within user-owned data
   (export/delete already cover career_profile).
3. **Delete** the merged orphans (they are fully contained in the T row).
Users with no conversations: untouched. Re-run: no orphans with conversations remain → no-op.

## Tests (first), local Postgres only — `scripts/db-verify/link-orphans-test.sql`
1. Seed on the **old** migration: user with orphan + linked row at latest conv (the prod case) → expect 23505 (repro).
2. With the fixed migration, seed: (a) prod case, (b) user with only one orphan, (c) user with 2 orphans + no linked row,
   (d) orphan user with no conversation, (e) user with a linked row only. Assert: no NULL orphans left for users with
   conversations; (b) linked; (c) one linked + one merged; (a) T row has union of skills, T's keys win,
   `merged_orphan_profiles` contains orphan id; (d),(e) untouched; other users untouched.
3. Run the migration a second time → no change (row-hash equality).
4. Static vitest: migration contains no unconditional `UPDATE … SET conversation_id` without the NOT EXISTS guard (cheap CI guard).

## Risks
- T row `updated_at` bumps via trigger → it becomes the "latest" row; fine, it now contains everything.
- Large `data` arrays: negligible (few orphans).
- Rollback: transactional; data snapshot retained in `merged_orphan_profiles`.
