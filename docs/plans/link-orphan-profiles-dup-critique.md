# Codex critique — link-orphan-profiles-dup plan

**Request changes.** The unique-violation diagnosis is correct. Skipping conflicts preserves stored data but leaves some profiles invisible to matching. Merging is reasonable, but the proposed merge does not yet justify “no data is lost.”

1. **P1 — Deduplicating skills only by `id` collapses legitimate chat skills.**  
   [Plan line 26](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:26). Chat extraction produces skills with `label`/`label_he` and **no `id`** ([schema](/workspace/projects/careeros/lai-51/lib/ai/extraction.ts:23)). Grouping all missing IDs together can discard every chat skill except one from active matching. The existing loader already has this bug; persisting it in the migration makes recovery harder.  
   **Fix:** Deduplicate nonempty taxonomy IDs; preserve ID-less skills or use an explicitly defined label identity. Test multiple distinct chat skills alongside CV skills.

2. **P1 — Bumping T’s timestamp can hide an unrelated linked profile.**  
   [Plan line 44](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:44). The loader’s user-level row is selected across **all** profiles, not just orphans ([query](/workspace/projects/careeros/lai-51/app/api/recommendations/route.ts:215)). Suppose older-conversation profile A is currently newest and contributes CV skills alongside T. Merging an orphan into T makes T newest; the loader then returns T alone. A’s skills disappear from matching although the migration never touched A.  
   **Fix:** Account for the pre-migration loader-selected row, or revise selection so migration timestamps cannot change which sources contribute. Add a fixture with T, a newer linked A, and an orphan; compare matching inputs before and after.

3. **P2 — The proposed conflict rules do not mirror the loader.**  
   [Plan lines 26–27](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:26). `orphan.data || T.data` retains T’s explicit JSON nulls, whereas the loader falls back for `interests`, `values`, and `constraints`. Also, its `Map` receives conversation skills first and user-level skills second, so **the latter wins duplicate IDs**, despite the comment suggesting otherwise ([implementation](/workspace/projects/careeros/lai-51/app/api/recommendations/route.ts:242)). Skill source affects matching strength.  
   **Fix:** Specify precedence explicitly, including JSON null versus missing keys, duplicate skill payloads, and ordering among multiple orphans. Either reproduce current behavior deliberately or document a correction; test both.

4. **P2 — NULL conversation IDs do not establish that every orphan is additive CV data.**  
   [Plan line 25](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:25). The [foreign key](/workspace/projects/careeros/lai-51/supabase/migrations/20260510183000_career_profile.sql:4) uses `ON DELETE SET NULL`; deleted conversations can therefore leave historical chat profiles. Meanwhile, CV confirmation intentionally **replaces** skills ([route](/workspace/projects/careeros/lai-51/app/api/cv/confirm/route.ts:93)). Unioning all historical orphan skills can reintroduce skills superseded by a later confirmation.  
   **Fix:** Define which historical data should become active and which should only be archived. Test a historical chat orphan and an older CV skill set superseded by a newer confirmation. “Skip is insufficient” does not prove “union everything” is correct.

5. **P2 — The snapshot is incomplete, and transaction rollback is not post-deployment recovery.**  
   [Plan line 28](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:28). The snapshot omits `last_extracted_at`, an actual column. It also does not preserve T’s original state, or the original state of the orphan linked in step 1. Deleted orphan snapshots alone cannot reconstruct the pre-migration database.  
   **Fix:** Capture complete before-images of every affected row, including T and the linked orphan, and define restoration. Keep existing provenance when combining multiple rows. Distinguish “archived for recovery” from “available to matching.”

6. **P2 — Edit-in-place is only conditionally safe; the migration-history explanation is wrong.**  
   [Plan lines 20–22](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:20). Absence from production history does not establish absence from staging or other persistent environments. Normal CLI history tracks migration filename timestamps, not execution-time versions; applied versions are skipped. See [Supabase CLI documentation](https://supabase.com/docs/reference/cli/supabase-db-push).  
   **Fix:** Verify histories across maintained environments. If universally unapplied, editing in place is reasonable. If applied anywhere, use a new corrective migration and explicitly resolve the failing pending predecessor—simply appending a later migration will not bypass it. Inspect the push dry run and reconcile any out-of-order/history discrepancies before deployment.

7. **P2 — A transaction alone does not protect against application read/modify/write races.**  
   [Plan line 22](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:22). CV confirmation reads JSON and later writes a whole replacement object. An in-flight request can overwrite the migration’s merged data/provenance with stale JSON, or update an orphan after it was deleted; the route checks errors but not affected-row count.  
   **Fix:** Pause and drain relevant writers during the backfill, or introduce coordinated atomic updates/version checks. Freeze the source/target mapping and delete only the exact rows successfully archived and merged.

8. **P3 — Tests omit the strongest multi-orphan case and do not enforce SQL behavior in CI.**  
   [Plan line 36](/workspace/projects/careeros/lai-51/docs/plans/link-orphan-profiles-dup.md:36). Two orphans without T leaves only one orphan to merge. It does not test merging multiple sources into an existing target. A naïve `UPDATE … FROM` matching multiple source rows updates the target using only one source, not an accumulated merge ([PostgreSQL documentation](https://www.postgresql.org/docs/current/sql-update.html)). The proposed textual `NOT EXISTS` check cannot detect this.  
   **Fix:** Test existing T plus three distinct orphans, exact snapshot coverage, full skill preservation, malformed/null JSON, and equal timestamps. Run executable SQL assertions in CI. Align the routes’ timestamp tie-breaking with the migration’s `id DESC` rule; currently they lack it.

No files modified. This was a static review; production migration history and database behavior were not independently exercised.
