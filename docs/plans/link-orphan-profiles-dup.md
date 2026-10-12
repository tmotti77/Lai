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

## Revision after Codex critique (supersedes "Approach" above)
The critique shows a data-merge is not neutral: id-only skill dedupe drops id-less chat skills (P1), a merge bumps
`updated_at` and changes which row the loader picks (P1), CV confirm *replaces* skills so a union can resurrect
superseded skills (P2), and app writers race a JSON merge (P2). Skipping leaves every conflicting orphan exactly as it
is today: no data lost, no change in what matching sees for those users (strict no-regression). So: **skip conflicts**.

Final migration (edited in place; see "Migration history" below):
1. Lock `career_profile` for the transaction (`lock table … in share row exclusive mode`) so app writers can't race the backfill.
2. Disable `career_profile_set_updated_at` for the transaction and re-enable at the end, so linking does **not** change
   `updated_at`. Otherwise a linked orphan would become the user's newest row and hide a newer linked row from the
   loader (critique #2 applies to linking too).
3. Per user with ≥1 conversation, T = latest conversation (`updated_at desc, id desc`). Link **one** orphan, the newest
   (`updated_at desc, id desc`), to T **only if no row exists at (user, T)**. Every other orphan is left in place.
4. Idempotent: on a re-run the guard finds the row at T and does nothing.
Follow-up (separate issue, app code): make the loader read *all* of a user's rows (orphans included) with an explicit,
tested precedence. That is the real fix for skipped orphans being invisible, and it's out of scope for a data migration.

### Migration history
`list_migrations` on prod (read-only) does not list it. It failed atomically on its only prod attempt, and there is no
staging project in Supabase (only `career-os`). Supabase branches are not used. Local dev DBs get reset. → Edit in place.
