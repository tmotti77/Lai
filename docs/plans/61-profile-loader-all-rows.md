# Plan: profile loader reads ALL of a user's `career_profile` rows (#61)

## Problem (from #61)

`getMostRecentConversationProfile` in `app/api/recommendations/route.ts` reads only the latest-conversation row plus
the single most-recently-updated row. The #60 `link_orphan_profiles` migration deliberately skips orphan rows
(`conversation_id IS NULL`) when a `(user_id, conversation_id)` row already exists, so those orphans stay unlinked.
Any orphan or older row that is not the newest is invisible to matching (e.g. CV skills lost).

## Acceptance criteria (verbatim from #61)

- Loader reads **all** of the user's career_profile rows.
- Skills are unioned (dedupe by id) across all rows.
- interests/values/constraints: latest-conversation row wins; otherwise most recently updated non-null value.
- Single-row and no-row cases behave as today.
- Unit tests cover: orphan + conversation row, multiple orphans, older non-latest row with skills, no rows.
- No DB migration / no data changes.

## Context map

| What | Where |
|---|---|
| Entry point | `POST /api/recommendations`, `app/api/recommendations/route.ts:43`. Line 70 calls the loader inside `Promise.all`, then line 75 `buildMatchingProfile`, line 76 `profileHash`, then the cache or `rankOccupations` |
| Current loader | `route.ts:162-278`, `getMostRecentConversationProfile` (not exported). Formal assessments come in through `getProfile(userId, "00000000-…")` with `.catch(() => null)` |
| Consumer of loader output | `lib/matching/profile.ts` `buildMatchingProfile(raw)`. It reads only `raw.data.{interests,skills,values,constraints}` and `raw.formal` |
| Cache key | `lib/matching/hash.ts`. sha1 over the built `MatchingProfile`, and **array order matters** (skills order changes the hash) |
| Formal assessments | `lib/db/assessments.ts` `getLatestByType(userId)` |
| DB-layer home | `lib/db/profile.ts` (service-role client pattern, `import "server-only"`, aliased in `vitest.config.mts`) |
| Writers (unchanged) | `merge_career_profile` RPC (chat), `mergeCvSkillsIntoLatestProfile` in `app/api/cv/confirm/route.ts:31` (CV) |
| Schema | `supabase/migrations/20260510183000_career_profile.sql`: `unique (user_id, conversation_id)` with `conversation_id` FK `ON DELETE SET NULL`, so a user can have N linked rows plus M orphans |
| Skill shapes | Chat: `{label, label_he, evidence, source}` with **no `id`** (`lib/ai/extraction.ts:23`). CV: `{id, name_he, source:"cv", evidence?}` (`lib/cv/types.ts`) |
| Existing test to replace | `tests/unit/db/profile-merge-loader.test.ts`. All 3 cases are `expect(true).toBe(true)` placeholders |
| Background | `docs/plans/link-orphan-profiles-dup.md` + `-critique.md` (this issue is the follow-up named there) |

**Commands** (same as `.github/workflows/ci.yml`):

```bash
npm run lint                     # eslint (eslint.config.mjs)
npx tsc --noEmit                 # typecheck
npm test                         # vitest run, all tests
npm test -- tests/unit/matching/profile-rows.test.ts   # single file
npm run build                    # CI also builds; uses the stub env vars listed in ci.yml
```

## Merge rules (how the criteria are made precise)

Definitions: **latest conversation** = the user's `conversations` row ordered `updated_at desc, id desc`.
**Primary row** = the `career_profile` row whose `conversation_id` is the latest conversation, if any.
**Recency order** = all rows sorted `updated_at desc, id desc`. The `id` tiebreak matches the #60 migration, so equal timestamps
give a deterministic order.

1. **No rows** → return `{ formal }`, exactly as today.
2. **Exactly one row** → return `{ ...row, formal }` with `row.data` **untouched**: no dedupe, no reordering. This is
   today's behaviour in both of today's single-row branches (the "no conversation" branch and "both queries hit the same row").
   It is implemented as an explicit short-circuit, so the "behave as today" criterion can't be broken by accident.
3. **Two or more rows**:
   - **`interests`, `values`, `constraints`**, each independently: if the primary row exists and its value is non-null
     (not `undefined`/`null`), use it. Otherwise use the first non-null value in recency order. This is the same `??` semantics
     as today, generalised to N rows.
   - **`skills`**: walk the rows **primary first, then recency order**, concatenating each row's `skills` array.
     For skills with an `id`, keep the **first** occurrence and drop later duplicates. Skills **without an `id`** (chat
     extraction) are **all kept**. The criterion says dedupe *by id*, so id-less skills are never collapsed. Today's
     `Map` keyed on `undefined` collapses every chat skill but one; that's critique P1 on #60. If the union is empty, set
     `skills: undefined`, as today.
   - **Every other `data` key** (`summary_he`, `skills_from_chat`, …) is a shallow spread of all rows' `data`, lowest precedence
     first and primary last. This generalises today's `{...userLevelData, ...convData}`. None of these keys reach matching.
   - **Row-level fields** (`id`, `conversation_id`, …): spread from the primary row, else the newest row, as today.
     Callers only read `data` and `formal`.
4. **Non-object `data` or non-array `skills`** on any row is treated as `{}` / `[]` (defensive, never throws).

Deliberate choice the issue leaves open: **on a duplicate skill id, the primary row's copy wins, then the newest row's.**
Today the user-level row's copy silently wins (critique #3 on #60). The skill's `source` sets matching strength
(`cv` = 1.0), so the winner is pinned by a test.

## Steps

### Step 1: Pure merge function plus its unit tests (test first)

- **Add** `lib/matching/profile-rows.ts` exporting
  `mergeProfileRows(rows: ProfileRow[], latestConversationId: string | null): MergedProfile | null`,
  where `ProfileRow = { id: string; conversation_id: string | null; updated_at: string; data: unknown; … }`.
  It returns `null` for zero rows. It's pure (no I/O, no `server-only`) and sorts its input itself, so the result doesn't
  depend on the order rows come back from the DB. It implements the merge rules above, and its doc comment states the precedence.
- **Add** `tests/unit/matching/profile-rows.test.ts` (written first, red). Cases:
  - **no rows** → `null`;
  - **single row** → returned `data` is reference-equal/deep-equal to the input, including a row with id-less chat skills
    and a row with internal duplicate ids (proves no dedupe is applied);
  - **orphan + conversation row**: the conversation row has chat interests/values/constraints and `skills: []`, and the orphan has
    CV skills. The merged result has the orphan's CV skills and the conversation row's chat fields;
  - **multiple orphans**: conversation row plus 2 orphans, each with distinct CV skills. All skills are present. One orphan has
    `constraints` and the conversation row doesn't, so the newer orphan's `constraints` win over the older one's;
  - **older non-latest row with skills**: three rows (primary, a newer unrelated linked row, an older row with skills).
    The older row's skills are present. This is the case today's two-row loader drops;
  - **primary null fallback**: primary `interests: null` → most recent non-null wins; primary non-null beats a newer row;
  - **no primary** (no conversation, or no row at the latest conversation) → recency order decides;
  - **dedupe by id**: the same `id` in primary and orphan gives one copy, the primary's (assert on `source`); 3 id-less chat
    skills across 2 rows → all 3 kept;
  - **determinism**: shuffled input gives the same output; equal `updated_at` → `id desc` tiebreak;
  - **malformed data** (`data: null`, `skills: "x"`) doesn't throw.
- Files: `lib/matching/profile-rows.ts`, `tests/unit/matching/profile-rows.test.ts`.

### Step 2: Loader reads all rows and uses the merge, plus loader tests

- **Add** an exported `loadMergedProfile(userId)` to `lib/db/profile.ts`, using the service-role client per the DB-layer
  convention. It runs three reads in parallel:
  1. latest conversation id: `conversations` `eq user_id`, `order updated_at desc`, `order id desc`, `limit 1`;
  2. **all** profile rows: `career_profile` `select *` `eq user_id`, with **no** `conversation_id` filter and **no** limit;
  3. formal: `getLatestByType(userId).catch(() => null)`. This keeps today's swallow-on-error behaviour and drops the
     zero-UUID `getProfile` call, which ran a pointless extra `career_profile` query.
  It returns `merged ? { ...merged, formal } : { formal }`. If query 1 or 2 returns an error, it **throws** (the route's
  existing `catch` returns 500). Today the error is ignored, and the empty profile it yields gets ranked and cached
  market-only. That would get worse once all rows are expected, so it's a deliberate small hardening.
- **Edit** `app/api/recommendations/route.ts`: delete `getMostRecentConversationProfile` and its comment (`:162-278`),
  import and call `loadMergedProfile(internalUserId)` at line 70, and drop the now-unused `getProfile` import. Nothing else
  in the route changes: consent check, force path and cache are untouched.
- **Rewrite** `tests/unit/db/profile-merge-loader.test.ts`. Mock `@/lib/supabase/service` and `@/lib/db/assessments`.
  The mock client records the filters/limits applied to `career_profile` and returns N rows. Assert:
  - the `career_profile` query has **no** `.limit()` and **no** `conversation_id` filter, so every row is read;
  - **orphan + conversation row** end to end: `buildMatchingProfile(await loadMergedProfile(u)).skills` contains the orphan's
    CV taxonomy ids, and `.values`/`.constraints` come from the conversation row;
  - **no rows** → `{ formal }`, and `buildMatchingProfile` gives all-null dimensions (as today);
  - **single row**, with and without a conversation: `profileHash(buildMatchingProfile(result), v)` equals the hash
    computed from `{ ...row, formal }`. That proves single-row users keep their cache key and don't trigger a new LLM call;
  - `formal` passes through; a `getLatestByType` rejection gives `formal: null`; a `career_profile` read error rejects.
- **Docs**: add one bullet under "Phase 4 architecture" in `CLAUDE.md`: the recommendations loader merges **all**
  `career_profile` rows via `lib/matching/profile-rows.ts`, with the precedence stated in its doc comment.
- Files: `lib/db/profile.ts`, `app/api/recommendations/route.ts`, `tests/unit/db/profile-merge-loader.test.ts`, `CLAUDE.md`.

## Verification

`npm run lint && npx tsc --noEmit && npm test` all green. In particular, `tests/unit/matching/profile.test.ts`,
`tests/unit/db/recommendations-cache.test.ts`, `tests/unit/db/cv-confirm-multi-row.test.ts` and
`tests/unit/cv/confirm-profile-merge.test.ts` must still pass. They're untouched and catch collateral changes. `npm run build` must pass.

## Out of scope

- Any DB migration, backfill, or orphan cleanup (per the acceptance criteria).
- The CV write path (`mergeCvSkillsIntoLatestProfile`) and its missing `id desc` tiebreak. That's a separate issue if wanted.
- `buildMatchingProfile` and the scorers.

## Risks

- **Matching changes for multi-row users.** That's intended, but their `profile_hash` changes, so each such user triggers
  one recompute (one `generateExplanations` LLM call) on their next visit. Single-row users are protected by the
  hash-equality test. Optional pre-merge sizing (read-only): count users with >1 `career_profile` row.
- **Union can resurrect superseded CV skills.** CV confirm *replaces* skills in the row it writes. An older orphan holding
  an earlier CV set now gets unioned back in (critique #4 on #60). The criteria ask for a union, so this plan follows them;
  if it matters, open a follow-up to define CV supersession.
- **Historical chat rows** (conversation deleted → `conversation_id` set NULL) now contribute skills and fallback values.
  That's intended (no data invisible). The primary row still wins for interests/values/constraints.
- **Duplicate id-less chat skills.** The same chat skill extracted in two conversations appears twice. The id-only dedupe
  required by the issue doesn't collapse it. Low impact on scoring; if the duplicates turn out to matter, a later change can
  dedupe by `label_he`.
- **Unbounded read.** A user has one row per conversation plus a few orphans, so the volume is negligible. Adding a limit would
  reintroduce the bug.
- **Throw on read error** changes a silent-empty-profile into a 500. It's safer (no market-only result is cached), and the
  route's existing error path handles it.

## Rollback

Code-only change: no schema, no migration, no stored data touched. Revert the squash-merged PR commit. Because the
recommendations cache is keyed by profile hash, a revert just makes affected users recompute once more. No cleanup needed.
