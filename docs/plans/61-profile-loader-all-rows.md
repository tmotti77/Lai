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
2. **Exactly one row** → return `{ ...row, formal }` with `row.data` **untouched**: no dedupe, no reordering. This matches
   today's behaviour in the "no conversation" branch and in the "both queries hit the same row" branch (`route.ts:226-228`).
   It is a **deliberate behaviour change**, not a no-op, in one case: today, when a latest conversation exists but the
   sole physical row is linked to a *different* conversation (or is an orphan), `conversationProfile` is `null` and
   `userProfile` is that one row, so the code falls into the merge branch (`route.ts:230-277`) instead of the
   same-row short-circuit. For chat-sourced skills (no `id`), today's `new Map(allSkills.map(s => [s.id, s]))` keys
   on `undefined` and collapses every one of them down to one — a bug (critique P1 on #60). The new loader's
   single-row short-circuit returns that row's skills **untouched**, so two or more id-less chat skills on that one
   row now all survive. This plan resolves the conflict explicitly in favour of **preserving raw data over
   replicating today's buggy collapse**: "behave as today" in the acceptance criteria is read as "a genuinely
   single-row user's data isn't dropped or deduped away," which is what the untouched short-circuit delivers, not as
   "reproduce the Map-keyed-on-undefined bug." This is implemented as an explicit short-circuit, so it can't be
   broken by accident, and a dedicated unit test pins the exact fixture: one physical row, linked to a conversation
   other than the latest (or orphaned), holding 2+ id-less chat skills — asserts all of them survive, documenting the
   behaviour change against today's collapse.
3. **Two or more rows**:
   - **`interests`, `values`, `constraints`**, each independently: if the primary row exists and its value is non-null
     (not `undefined`/`null`), use it. Otherwise use the first non-null value in recency order. This is the same `??` semantics
     as today, generalised to N rows.
   - **`skills`**: walk the rows in **recency order** (newest first), concatenating each row's `skills` array.
     For skills with an `id`, keep the **first** occurrence encountered in that walk (i.e. the newest row's copy wins
     on a duplicate id) and drop later duplicates. Skills **without an `id`** (chat extraction) are **all kept**. The
     criterion says dedupe *by id*, so id-less skills are never collapsed. Today's `Map` keyed on `undefined`
     collapses every chat skill but one; that's critique P1 on #60. If the union is empty, set `skills: undefined`,
     as today. **Scope note**: this plan deliberately does *not* give the primary row special precedence for the
     skills union — "newest wins" needs no extra ordering concept beyond recency, which is already computed for the
     scalar fields below, and it avoids introducing a new rule that could silently reduce a CV-confirmed skill's
     matching strength (`source: "cv"` sets strength `1.0`) by letting an older primary row's stale copy of the same
     id win over a newer row's. The winner is still pinned by a unit test so the choice is visible and reviewable.
   - **Row-level metadata and every other `data` key** (`summary_he`, `skills_from_chat`, …): rather than defining a
     precedence rule for currently-unused keys, the merged row is the **primary row if one exists, else the newest
     row**, taken as-is (`{...baseRow}`), with only `data.interests`, `data.values`, `data.constraints`, and
     `data.skills` overwritten per the rules above. This is simpler than a generalised deep-merge across all rows and
     keeps the change scoped to the fields matching actually reads (`buildMatchingProfile` only reads `data.{interests,
     skills,values,constraints}` and `formal` — see context map). Callers only read `data` and `formal`.
4. **Non-object `data` or non-array `skills`** on any row is treated as `{}` / `[]` (defensive, never throws) **only
   inside the 2+-row merge path**. The single-row short-circuit (rule 2) returns `row.data` completely untouched, so a
   malformed single row is passed through as-is rather than normalized — consistent with "no dedupe, no reordering"
   for that case. A malformed `data` on a non-primary/non-base row in the merge path still can't throw.

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
  - **dedupe by id**: the same `id` in primary and a newer orphan gives one copy, the **newer row's** (assert on `source`,
    e.g. a stale primary `source: "cv"` entry loses to a fresher orphan `source: "cv"` entry with the same id); 3 id-less
    chat skills across 2 rows → all 3 kept;
  - **per-field boundary cases, each of `interests`/`values`/`constraints` independently**:
    - primary `[]` (or `{}`, matching the field's real shape) **wins outright** — an empty-but-defined value is not
      `null`/`undefined`, so it is not a "missing value" and must not fall back to another row;
    - primary `null`, newest non-primary row also `null`, an *older* row has a non-null value → the older row's value
      wins (fallback must skip past intermediate nulls, not stop at the first non-primary row);
  - **formal-only profile**: zero `career_profile` rows but a completed formal assessment exists → the merged result is
    `{ formal }` (no `data` key), `buildMatchingProfile` reports null `interests`/`skills`/`values`/`constraints` but
    non-null values for whichever formal-backed dimensions (`big5`, and `values`/`constraints` if sourced from formal)
    depend on `formal`. This is distinct from the plain "no rows → all-null dimensions" case, which only holds when
    formal is also absent;
  - **determinism**: shuffled input gives the same output; equal `updated_at` → `id desc` tiebreak;
  - **malformed data in the merge path** (`data: null`, `skills: "x"` on a non-single, non-primary row) doesn't throw;
    a malformed **single row** (the only row) is returned untouched by the short-circuit, per rule 4's exception.
- Files: `lib/matching/profile-rows.ts`, `tests/unit/matching/profile-rows.test.ts`.

### Step 2: Loader reads all rows and uses the merge, plus loader tests

- **Add** an exported `loadMergedProfile(userId)` to `lib/db/profile.ts`, using the service-role client per the DB-layer
  convention. It runs reads in parallel:
  1. latest conversation id: `conversations` `eq user_id`, `order updated_at desc`, `order id desc`, `limit 1`;
  2. **all** profile rows, **paginated**: `career_profile` `select *` `eq user_id`, `order id asc` (a stable, unique
     order — `id` is the PK, so no page can shift rows between requests), `range(offset, offset + PAGE_SIZE - 1)` with
     `PAGE_SIZE = 1000` matching the local Supabase API's `max_rows = 1000` (`supabase/config.toml:18`), looping and
     accumulating pages until a page returns fewer than `PAGE_SIZE` rows. **No `.limit()` without `.range()`** — the
     earlier "no `.limit()`" framing was wrong: PostgREST silently caps unlimited `select *` at `max_rows` regardless
     of whether `.limit()` is called, so pagination is required to actually read "all" rows, not just omitting a cap;
  3. formal: `getLatestByType(userId).catch(() => null)`. This keeps today's swallow-on-error behaviour and drops the
     zero-UUID `getProfile` call, which ran a pointless extra `career_profile` query.
  It returns `merged ? { ...merged, formal } : { formal }`. If query 1, any page of query 2, or the pagination loop
  itself returns an error, `loadMergedProfile` **throws** — caught by the route's existing `catch` (see below for the
  response change that goes with this). Today the error is ignored, and the empty profile it yields gets ranked and
  cached market-only. That would get worse once all rows are expected, so it's a deliberate small hardening.
- **Edit** `app/api/recommendations/route.ts`:
  - Delete `getMostRecentConversationProfile` and its comment (`:162-278`), import and call
    `loadMergedProfile(internalUserId)` at line 70, and drop the now-unused `getProfile` import. Nothing else about
    the route's control flow changes: consent check, force path and cache are untouched.
  - **Harden the existing catch block** (`route.ts:155-159`): it currently returns `{ error: "recommendations_failed",
    message: err.message }` to the client, which would leak internal error text (e.g. a Postgres error string) for the
    new throw-on-read-error path. Change the response body to a fixed, generic message (e.g.
    `{ error: "recommendations_failed" }`, no `message` field, or a static `message: "internal_error"`) and keep
    `console.error("[recommendations] error", { message, stack: err instanceof Error ? err.stack : undefined })` (or
    equivalent) so the detail is still visible server-side. This is a one-line behaviour change to an existing branch,
    not new error-handling surface.
- **Rewrite** `tests/unit/db/profile-merge-loader.test.ts`. Mock `@/lib/supabase/service` and `@/lib/db/assessments`.
  The mock client records the filters/ordering/range applied to `career_profile` and can return multiple pages. Assert:
  - **pagination correctness**: given `PAGE_SIZE + 1` rows split across two mocked pages, the final page's row (and its
    skills) are present in the merged result — replaces the old "no `.limit()`" assertion, which didn't actually prove
    all rows were read;
  - **ordering**: every `career_profile` page request carries `order("id", { ascending: true })` (or equivalent) and a
    `range` that advances monotonically, so pages can't overlap or skip rows;
  - **user scoping**: every `career_profile` page request and the `conversations` lookup both carry `eq("user_id", u)`
    for the requested user — a regression here would leak or merge another user's rows;
  - **page-read failure**: the second page's mocked response is an error → `loadMergedProfile` rejects (not a partial
    merge of only the first page);
  - **orphan + conversation row** end to end: `buildMatchingProfile(await loadMergedProfile(u)).skills` contains the orphan's
    CV taxonomy ids, and `.values`/`.constraints` come from the conversation row;
  - **no rows** → `{ formal }`, and `buildMatchingProfile` gives all-null dimensions (as today, and only when `formal`
    is also absent — see the formal-only case in Step 1);
  - **single row**, with and without a conversation: `profileHash(buildMatchingProfile(result), v)` equals the hash
    computed from `{ ...row, formal }`. That proves single-row users keep their cache key and don't trigger a new LLM call;
  - `formal` passes through; a `getLatestByType` rejection gives `formal: null`; a `career_profile` read error rejects.
  - **route-level**: a separate test (or an addition to the existing route test file, if any) drives
    `loadMergedProfile` to throw via a `conversations` read failure, and again via a `career_profile` page failure, and
    asserts the route responds `500` with the generic body (no leaked message) and that `rankOccupations` /
    `generateExplanations` / the recommendations-cache write are never reached.
- Files: `lib/db/profile.ts`, `app/api/recommendations/route.ts`, `tests/unit/db/profile-merge-loader.test.ts`.

## Verification

`npm run lint && npx tsc --noEmit && npm test` all green. In particular, `tests/unit/matching/profile.test.ts`,
`tests/unit/db/recommendations-cache.test.ts`, `tests/unit/db/cv-confirm-multi-row.test.ts` and
`tests/unit/cv/confirm-profile-merge.test.ts` must still pass. They're untouched and catch collateral changes. `npm run build` must pass.

## Out of scope

- Any DB migration, backfill, or orphan cleanup (per the acceptance criteria).
- The CV write path (`mergeCvSkillsIntoLatestProfile`) and its missing `id desc` tiebreak. That's a separate issue if wanted.
- `buildMatchingProfile` and the scorers.
- **`CLAUDE.md`.** The earlier draft of this plan proposed a doc bullet under "Phase 4 architecture." Per this
  project's own convention (checked-in `CLAUDE.md` is loaded into every session and should stay "short, factual, and
  current," not accrue a bullet per issue) and the critique's note that project docs need separate approval, this plan
  edits only the files listed under each step. `lib/matching/profile-rows.ts`'s doc comment is the documentation of
  record for the merge precedence.

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
- **Row volume stays small in practice** (one row per conversation plus a few orphans), but the read is now paginated
  rather than a single unbounded `select *`, because PostgREST's `max_rows` config caps any unlimited select at 1000
  regardless of whether `.limit()` is used (`supabase/config.toml:18`) — without pagination, a user who happens to
  cross that row count would silently lose rows again, the exact bug this plan exists to fix.
- **Throw on read error** changes a silent-empty-profile into a 500. It's safer (no market-only result is cached), and
  the route's existing error path handles it. The error response is now a fixed, generic message — the previous plan
  would have leaked the raw exception message (e.g. a Postgres error string) to the client via the route's existing
  `catch`; detail still reaches the server log via `console.error`.

## Rollback

Code-only change: no schema, no migration, no stored data touched. Revert the squash-merged PR commit. Because the
recommendations cache is keyed by profile hash, a revert just makes affected users recompute once more. No cleanup needed.
