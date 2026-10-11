# Plan — #51 User data export + hard delete

> Issue: [#51](https://github.com/tmotti77/Lai/issues/51) `feat(privacy): user data export + hard delete endpoints (required before beta)`
> Branch: `feat/51-data-export-delete`
> Status: plan only. Needs a Codex critique (`docs/plans/51-data-export-delete-critique.md`) before any code is written.

## 1. Problem

CareerOS stores CVs (raw file + extracted text), chat transcripts, psychometric answers, interview transcripts and free-text feedback. There is no self-service way to see or remove any of it. The privacy page (`app/(marketing)/privacy/page.tsx`) tells users to email a placeholder address. The only export path is `GET /api/admin/feedback/export`, which is admin-only, covers one table, and uses a bearer token.

Before the closed beta we need GDPR / Israeli Privacy Protection Law–style data-subject rights:

1. **Access/portability**: `GET /api/me/export` returns everything we hold about the caller.
2. **Erasure**: `DELETE /api/me` hard-deletes the caller's rows in every user-scoped table, their CV objects in Storage, and their `auth.users` row.

Both must work for **anonymous** users (cookie identity `co_anon`) and for users whose `career_profile` rows were orphans (`conversation_id IS NULL`) or were re-linked by `20260903000000_link_orphan_profiles.sql`.

### Acceptance criteria (from the issue)

- [ ] Export returns every row the caller owns across all user tables, and lists or serves their storage objects. It never returns another user's data (RLS + tests).
- [ ] Delete removes all user rows, storage objects and the auth user. It is idempotent. Signing in again afterwards gives a fresh, empty account.
- [ ] Works for anonymous users and for users with linked orphan profiles.
- [ ] Requires an identity, is rate limited, and delete requires explicit confirmation.
- [ ] Partial-failure handling: the storage and DB deletion order is documented, failures are logged to Sentry, and the operation can be retried.
- [ ] A test asserts that every user-scoped table in the migrations is covered, and fails when a new table is added without handling.
- [ ] Unit/integration tests; CI `test` is green.
- [ ] The privacy page and docs describe export and deletion.

## 2. Inventory: what is user-scoped

Built from all 12 files in `supabase/migrations/`. "Owner key" is how a row is attributed to a `public.users.id`.

| # | Table | Migration | Owner key / how found | FK to parent, on delete | RLS today |
|---|---|---|---|---|---|
| 1 | `users` | `…134256_init` | `id` (the root) | `auth_id → auth.users` **cascade** | self select/update via `auth_id` |
| 2 | `anonymous_sessions` | `…134256_init` | `user_id` | `→ users` cascade | none (service only) |
| 3 | `consents` | `…134256_init` | `user_id` | `→ users` cascade | self select |
| 4 | `conversations` | `…140000_conversations` | `user_id` | `→ users` cascade | self all |
| 5 | `messages` | `…140000_conversations` | `conversation_id IN (owned conversations)` | `→ conversations` cascade | self via join |
| 6 | `assessments` | `…164409_assessments` | `user_id` | `→ users` cascade | self all |
| 7 | `career_profile` | `…183000_career_profile` | **`user_id` only, never via conversation** (orphans have `conversation_id IS NULL`) | `user_id → users` cascade; `conversation_id → conversations` **set null** | self all |
| 8 | `recommendations` | `…193521_occupations_and_recommendations` | `user_id` | `→ users` cascade | self all |
| 9 | `plans` | `…153822_plans` | `user_id` | `→ users` cascade; `recommendation_id → recommendations` cascade | self all |
| 10 | `plan_tasks` | `…153822_plans` | `plan_id IN (owned plans)` | `→ plans` cascade | self via join |
| 11 | `cv_uploads` | `…181115_cv_uploads` | `user_id` | `→ users` cascade | self select |
| 12 | `interview_sessions` | `…120000_interview` | `user_id` | `→ users` cascade | self select |
| 13 | `interview_messages` | `…120000_interview` | `session_id IN (owned sessions)` | `→ interview_sessions` cascade | self select via join |
| 14 | `feedback` | `…phase_6b_feedback` | `user_id` | `→ users` cascade | none (service only) |

**Not user-scoped**, so nothing to export or delete: `skills`, `occupations`, `catalog_version`.

**Outside `public`:**

- **Storage**: bucket `cv-uploads` (private), path `<users.id>/<uuid>.{pdf,docx}`. Objects can exist with **no** `cv_uploads` row. `app/api/cv/upload/route.ts` uploads first and inserts the row afterwards, so a failed `createCvUpload` leaves an orphan object. We therefore find objects by **listing the `<user_id>/` prefix**, and also by every `cv_uploads.storage_path`, then take the union.
- **Auth**: `auth.users` row, found via `users.auth_id`. Deleting it cascades to `public.users` (FK `on delete cascade`).
- **Not ours to delete**: Vercel Analytics holds aggregate events with no user id (by design, `lib/analytics.ts`). Sentry `beforeSend` strips PII. Anthropic receives prompts but keeps no per-user store we control. The privacy page will say all of this.

### Identity resolution (anonymous users and linked orphans)

The routes must **not** call `getOrCreateAnonymousUserId`, because it inserts rows: export or delete would create an account just to delete it. Add a read-only resolver to `lib/anonymous.ts`:

```ts
// Returns null when the visitor has no identity. Never inserts, never promotes.
export async function resolveCurrentUserIds(authedUserId?: string): Promise<{
  primaryId: string;                 // users.id to act on
  authId: string | null;             // auth.users.id, null for anonymous
  isAnonymous: boolean;
  linkedAnonymousId: string | null;  // an unpromoted anon row reachable from this browser's co_anon cookie
} | null>
```

- **Authenticated**: `users` where `auth_id = authedUserId`. If no row exists yet but `co_anon` maps to a live anonymous row, treat that anon row as the account: it is the row `getOrCreateAnonymousUserId` *would* promote. If neither exists, return `null` (nothing to export, delete is a no-op that still removes the auth user).
- **Authenticated with a stale `co_anon`** that maps to a *different*, still `is_anonymous = true` row: return it as `linkedAnonymousId`. The same browser proves the same person. Export includes it under `linked_anonymous`, and delete removes it too. This covers the "signed in on a second device, the anon footprint on device 1 never promoted" case, as far as the current browser can prove ownership.
- **Anonymous**: `anonymous_sessions` where `token = co_anon AND expires_at > now()` → `user_id`. An expired or missing cookie gives `null`, which maps to 401.
- **Orphan-linked profiles**: every `career_profile` read and delete is by `user_id`, never by `conversation_id`. Rows with `conversation_id IS NULL` and rows re-linked by the 2026-09-03 migration are therefore both covered. Tests pin this (§5).
- **Out of scope, but documented**: anonymous `users` rows created by the middleware race (described in the `ensureAnonymousCookie` comment), which no cookie points to any more. They cannot be attributed to a person. File a follow-up issue for a retention sweep (anonymous rows with no session and older than 30 days).

## 3. Design

### 3.1 New modules

```
lib/privacy/
  registry.ts      # USER_DATA_TABLES + STORAGE_BUCKETS: single source of truth (§3.2)
  identity.ts      # thin wrapper: request → resolveCurrentUserIds (auth client + cookies)
  export.ts        # buildUserExport(ids, opts) → ExportBundle (pure orchestration over a Supabase client)
  delete.ts        # deleteUserData(ids) → DeleteReport (stage machine, §3.5)
  rateLimit.ts     # claimExportSlot / claimDeletionLock (atomic guarded UPDATEs, §3.6)
app/api/me/route.ts          # DELETE
app/api/me/export/route.ts   # GET
app/(app)/settings/page.tsx  # RSC shell
components/settings/
  DataRightsPanel.tsx        # export button + delete section (client)
  DeleteAccountDialog.tsx    # confirmation dialog (client)
supabase/migrations/<ts>_user_data_rights.sql   # file only; applied through the normal pipeline
```

`lib/privacy/*` uses `createServiceClient()` internally. This is the same service-role pattern as `lib/db/*`, because RLS only matches `auth.uid()` and cannot serve anonymous users. Isolation comes from explicit owner filters plus tests (§5), with RLS as defence in depth for authenticated reads.

### 3.2 Registry (`lib/privacy/registry.ts`)

```ts
type Scope =
  | { kind: "root" }                                               // users
  | { kind: "user_id" }                                            // WHERE user_id = ANY(ids)
  | { kind: "parent"; parent: TableName; fk: string };             // WHERE fk IN (owned parent ids)

export const USER_DATA_TABLES = {
  users:              { scope: { kind: "root" } },
  anonymous_sessions: { scope: { kind: "user_id" }, redact: ["token"] },
  consents:           { scope: { kind: "user_id" } },
  conversations:      { scope: { kind: "user_id" } },
  messages:           { scope: { kind: "parent", parent: "conversations", fk: "conversation_id" } },
  assessments:        { scope: { kind: "user_id" } },
  career_profile:     { scope: { kind: "user_id" } },
  recommendations:    { scope: { kind: "user_id" } },
  plans:              { scope: { kind: "user_id" } },
  plan_tasks:         { scope: { kind: "parent", parent: "plans", fk: "plan_id" } },
  cv_uploads:         { scope: { kind: "user_id" } },
  interview_sessions: { scope: { kind: "user_id" } },
  interview_messages: { scope: { kind: "parent", parent: "interview_sessions", fk: "session_id" } },
  feedback:           { scope: { kind: "user_id" } },
} as const satisfies Record<TableName, { scope: Scope; redact?: string[] }>;

export const NON_USER_TABLES = ["skills", "occupations", "catalog_version"] as const; // with reasons in comments
export const STORAGE_BUCKETS = { "cv-uploads": { prefix: (userId: string) => `${userId}/` } } as const;
```

`TableName` comes from `keyof Database["public"]["Tables"]` in `types.gen.ts`, so a typo fails `tsc`. The coverage test (§5.1) is what ties this registry to the migrations.

`redact`: `anonymous_sessions.token` is a live bearer credential. Exporting it into a file that may be shared would leak a session, so the export replaces it with `"[redacted]"` and keeps `created_at`, `last_seen_at` and `expires_at`.

### 3.3 `GET /api/me/export`

Flow:

1. `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 30`.
2. Resolve identity (§2). `null` → `401 { error: "no_identity" }`.
3. `claimExportSlot(primaryId)` (§3.6) → `429 { error: "rate_limited", retry_after_s }` with a `Retry-After` header.
4. `buildUserExport(ids)`:
   - Reads tables in registry order. Parents come before children so child queries can use the parent id lists. Uses `.in(fk, parentIds)` in chunks of 200 ids to stay under URL length limits.
   - **Paginates every query** with `.range(from, from + 999)` until a short page. PostgREST's default `max_rows` is 1000, so a long chat history would otherwise be silently truncated. A test pins this.
   - Includes `linked_anonymous` (the same structure) when `linkedAnonymousId` is set.
   - Storage: lists `cv-uploads/<id>/` (paginated `list(prefix, { limit: 100, offset })`) and unions in `cv_uploads.storage_path`. For each object, `createSignedUrl(path, 900, { download: original_filename ?? basename })`. **Signed URLs, not inline base64**: CVs go up to `MAX_FILE_SIZE_BYTES` each, and inline copies would exceed the Vercel response limit (4.5 MB). URLs expire after 15 minutes, and the JSON says so in Hebrew and English. A path with no object (already deleted, or swept by the 30-day lifecycle) is listed with `available: false`, not treated as an error.
   - Auth profile: `email`, `created_at` and `last_sign_in_at` from the session's `auth.getUser()` (no admin call needed).
5. Response: `application/json; charset=utf-8`, `content-disposition: attachment; filename="careeros-export-YYYY-MM-DD.json"`, `cache-control: no-store`, `x-content-type-options: nosniff`.
6. `track("data_exported", { is_anonymous })`. This is a new allowlisted event in `lib/analytics.ts`, with no user id.

Bundle shape (versioned so the format can evolve):

```jsonc
{
  "format_version": 1,
  "exported_at": "…",
  "notice_he": "…", "notice_en": "…",           // what's included, signed-URL expiry
  "account": { "user_id": "…", "is_anonymous": false, "auth": { "email": "…", "created_at": "…" } | null },
  "tables": { "users": [ … ], "conversations": [ … ], "messages": [ … ], … every registry key, [] when empty },
  "storage": [ { "bucket": "cv-uploads", "path": "…", "original_filename": "…", "size_bytes": 123, "signed_url": "…", "expires_at": "…", "available": true } ],
  "linked_anonymous": { "user_id": "…", "tables": { … }, "storage": [ … ] } | null
}
```

Every registry key is always present, even when empty. The coverage test asserts this, so the export cannot silently drop a table.

**No `requireConsent`**, as a deliberate exception to the "every mutation route calls `requireConsent`" rule. Export is a read. Delete is the user withdrawing everything. Neither can be conditional on processing consent: a user who revoked consent, or never gave it, still has the right to access and erase. The route files will carry a comment with this rationale, and the critique should confirm it.

### 3.4 `DELETE /api/me`

Request: `DELETE /api/me` with JSON body `{ "confirmation": "DELETE_MY_ACCOUNT" }`, validated by `z.object({ confirmation: z.literal(DELETE_CONFIRMATION) })` and exported from `lib/privacy/delete.ts`. Responses:

| Case | Status | Body |
|---|---|---|
| Missing or wrong confirmation | 400 | `{ error: "confirmation_required" }` |
| `Origin` header present and not same-origin | 403 | `{ error: "bad_origin" }` |
| No identity, and no auth session | 401 | `{ error: "no_identity" }` |
| Deletion already in progress (lock held) | 409 | `{ error: "deletion_in_progress" }` |
| Success, including "nothing left to delete" | 200 | `{ deleted: true, report: { tables: Record<table, number>, storage_objects: number, auth_user: "deleted" \| "absent" \| "n/a" } }` |
| A stage failed | 500 | `{ error: "deletion_incomplete", stage: "storage" \| "db" \| "auth", retryable: true }` |

On success, and also on a `db`/`auth`-stage failure after data is gone: delete the `co_anon` cookie on the response, and call `supabase.auth.signOut({ scope: "local" })` on the cookie client so the browser drops its Supabase session cookies.

CSRF: the JSON body plus a non-simple method forces a CORS preflight, and our cookies are `sameSite: lax`. The explicit `Origin` check is defence in depth and costs one line.

**Idempotency.** The rule is "a credential is present but nothing is left → 200 with zero counts". This covers:

- A replayed request that still carries the old Supabase session or `co_anon` cookie.
- A retry after a stage-3 failure (§3.5).
- An anonymous user whose next request got a fresh middleware-minted cookie. This resolves to a new, empty anonymous row; deleting it is harmless and returns zeros.

Only a request with no credential at all gets 401. A test pins each case.

### 3.5 Deletion order and partial failure (`lib/privacy/delete.ts`)

`deleteUserData({ primaryId, authId, linkedAnonymousId })` runs these stages for each `users.id` in `{primaryId, linkedAnonymousId}`. Every stage is idempotent, so a retry restarts from stage 0 and converges.

| Stage | Action | On failure |
|---|---|---|
| **0. Lock** | `claimDeletionLock(id)`: `UPDATE users SET deletion_requested_at = now() WHERE id = $1 AND (deletion_requested_at IS NULL OR deletion_requested_at < now() - interval '2 minutes') RETURNING id`. No row returned and the user still exists → 409. No row and the user is gone → skip to stage 3. | 500, nothing changed |
| **1. Storage** | List the `cv-uploads/<id>/` prefix (paginated), union with `cv_uploads.storage_path`, then `storage.remove(paths)` in batches of 100. A "not found" result counts as success. | **Abort before touching the DB.** Sentry `captureException(err, { tags: { context: "account_delete", stage: "storage" } })`, then 500 `retryable`. Rows still point at the remaining objects, so a retry finds them again. |
| **2. DB** | `svc.rpc("delete_user_data", { p_user_id: id })`: one transaction (§3.5.1). Returns per-table counts. | The transaction rolls back, so the DB is untouched. Storage is already gone, which is acceptable: data minimisation, and `cv_uploads` rows then point to missing objects, which export reports as `available: false`. Sentry `stage: "db"`, then 500 `retryable`. |
| **2b. Storage sweep** | List the prefix again and remove anything found. This catches a CV uploaded concurrently between stage 1 and stage 2. | Best effort. Sentry `stage: "storage_sweep"` at `level: "warning"`, success is still returned, and the 30-day bucket lifecycle rule is the backstop. |
| **3. Auth** | Only for `primaryId` when `authId` is set: `svc.auth.admin.deleteUser(authId)`. A 404 "user not found" counts as success (`"absent"`). | Sentry `stage: "auth"`, then 500 `retryable`. Public data is already gone. The user still holds a valid session, so a retry resolves to no `users` row → the route goes straight to stage 3 with `authId` from the session → it completes. |

**Why storage → DB → auth:**

- **Storage first**: object paths are only discoverable while we know the `user_id`. After the DB delete we still know the id in memory, but we would lose `cv_uploads.storage_path` for the union. A storage failure also aborts with zero DB changes, so it is fully retryable.
- **Auth last**: deleting the auth user first would cascade `public.users` away *and* invalidate the caller's session. Any later failure (storage) would then be un-retryable by the user and would leave orphaned CV files. With auth last, the user always holds a working credential until everything else is gone.
- **No soft delete.** `users.deleted_at` exists from init but is unused. We do not use it; this is a hard delete per the issue. `deletion_requested_at` is reused only as a short-lived lock, and the row vanishes in stage 2.

Logging: `console.info("[privacy] delete", { stage, table_counts })` on success, with no PII. The Sentry `extra` field is `{ userId }`: an opaque uuid that refers to nothing once deletion succeeds, and that lets us trace a stuck retry. No email or content ever goes to Sentry or logs.

Analytics: `track("account_deleted", { is_anonymous, had_auth_user: boolean })`. This is a new allowlisted event.

#### 3.5.1 Migration `<ts>_user_data_rights.sql` (file only; not applied to any real DB in this issue)

```sql
-- Rate-limit column for exports (atomic-transition pattern, like nps_* columns).
alter table public.users add column last_export_at timestamptz;

-- Hard delete of one user's rows, in one transaction, children before parents.
-- Explicit deletes (not just a cascade from users) so the coverage test can verify each
-- table is named, and so counts are returned for the deletion report.
create or replace function public.delete_user_data(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; n int;
begin
  delete from public.interview_messages where session_id in (select id from public.interview_sessions where user_id = p_user_id); get diagnostics n = row_count; r := r || jsonb_build_object('interview_messages', n);
  delete from public.interview_sessions where user_id = p_user_id; …
  delete from public.plan_tasks        where plan_id in (select id from public.plans where user_id = p_user_id); …
  delete from public.plans             where user_id = p_user_id; …
  delete from public.recommendations   where user_id = p_user_id; …
  delete from public.career_profile    where user_id = p_user_id; …   -- by user_id: covers orphans (conversation_id is null)
  delete from public.messages          where conversation_id in (select id from public.conversations where user_id = p_user_id); …
  delete from public.conversations     where user_id = p_user_id; …
  delete from public.assessments       where user_id = p_user_id; …
  delete from public.cv_uploads        where user_id = p_user_id; …
  delete from public.feedback          where user_id = p_user_id; …
  delete from public.consents          where user_id = p_user_id; …
  delete from public.anonymous_sessions where user_id = p_user_id; …
  delete from public.users             where id = p_user_id; …
  return r;
end; $$;

revoke execute on function public.delete_user_data(uuid) from public, anon, authenticated;
grant  execute on function public.delete_user_data(uuid) to service_role;
```

- The `REVOKE` satisfies the architectural rule for every SECURITY DEFINER function.
- `career_profile` is deleted **before** `conversations`. Otherwise the `on delete set null` FK would briefly turn linked profiles into orphans inside the transaction (harmless, but this keeps the intent obvious). Rows are matched by `user_id`, so already-orphaned rows go too.
- Types: `npm run db:types` needs the linked project, and this issue must not touch it. Add the `last_export_at` column and the `delete_user_data` RPC signature to `lib/db/types.gen.ts` **by hand**, in generator format. Regenerate for real when the migration is pushed through the pipeline, and expect an empty diff.
- `catalog_version`, `occupations` and `skills` are not touched.

**Alternative considered**: per-table `.delete()` calls from TypeScript with no RPC. That is simpler and can be fully exercised by the in-memory fake, but it is not atomic: a mid-way failure leaves, for example, conversations without messages. Rejected in favour of the RPC, so the only partial states are at the three documented stage boundaries. The critique should weigh in.

### 3.6 Rate limiting (`lib/privacy/rateLimit.ts`)

There is no rate-limit infrastructure in the repo: no Redis/Upstash, and nothing durable in-memory on serverless. Use the existing **atomic guarded UPDATE … RETURNING** pattern from Phase 6b, keyed on the user row:

- **Export**: `UPDATE users SET last_export_at = now() WHERE id = $1 AND (last_export_at IS NULL OR last_export_at < now() - interval '60 seconds') RETURNING id`. No row → 429 with `Retry-After: 60`. One export per minute is enough for a human and stops scripted hammering of an export that runs about 15 paginated queries.
- **Delete**: the stage-0 lock (§3.5) doubles as the limiter. One in-flight deletion per user, and re-entry is allowed after 2 minutes so a crashed attempt can be retried.

Per-identity limiting is the right granularity. A fresh anonymous identity has no data, so minting identities to bypass the limit gains an attacker nothing. Platform-level IP limiting (Vercel firewall) is out of scope; note it in the Phase 7 checklist.

### 3.7 Settings UI (Hebrew, RTL)

- **New route `app/(app)/settings/page.tsx`** (RSC). It resolves identity read-only and renders `<DataRightsPanel isAnonymous hasIdentity />`. If there is no identity it shows "אין נתונים שמורים עבורך" ("No data is stored for you").
- **Entry points**: a "הגדרות ופרטיות" ("Settings and privacy") link on the `/recommendations` page next to "שמור דוח" ("Save report"), on the home page footer, and on the privacy page ("לניהול הנתונים שלך" → `/settings`, "to manage your data"). These pages have no shared nav today. Adding a global header is out of scope.
- **`DataRightsPanel`**:
  - "הורדת הנתונים שלי" ("Download my data"): a `<Button asChild><a href="/api/me/export" download>`. On 429 the anchor can't show feedback, so use `fetch` → `blob` → object-URL download, with a toast on 429/500 (`sonner`, already used in `/plan`).
  - "מחיקת החשבון והנתונים" ("Delete account and data"): a destructive-variant button that opens `DeleteAccountDialog`.
- **`DeleteAccountDialog`** (Radix Dialog via `components/ui`, same as `SaveReportDialog`):
  - Lists in Hebrew what will be deleted (conversations, questionnaires, CV files, recommendations, plans, interviews, feedback, and the account itself for signed-in users) and states that it is irreversible. It suggests downloading the data first, with an inline export link.
  - **Typed confirmation**: the user must type `מחק` ("delete") into an input before the confirm button enables. The client then sends the server constant `DELETE_MY_ACCOUNT`. The Hebrew word stays UX, while the wire token is ASCII and stable.
  - States: idle → deleting (spinner, buttons disabled, dialog not dismissable) → success (full navigation to `/?deleted=1`, where the home page shows a one-line "הנתונים נמחקו" ("Your data was deleted") notice) or error (persistent inline banner with "נסה שוב" ("Try again"); a 409 shows "המחיקה כבר בתהליך" ("Deletion is already in progress")).
  - A11y: the dialog has a title and description, the input has a `<label>`, focus starts on the input, the confirm button has `aria-disabled` and the focus-visible ring, and errors are `role="alert"`. Add `/settings` to `scripts/verify-all-surfaces.mjs` (3 viewports + axe).
- **RTL**: logical properties only (`ms-*`, `me-*`, `text-start`). The ASCII token is never shown to users.
- **i18n**: all strings go in a new `he.settings` block in `lib/i18n/he.ts` (`title`, `export.*`, `delete.*`, `errors.*`). Nothing is hard-coded.

### 3.8 Privacy page and docs

- Rewrite `app/(marketing)/privacy/page.tsx` "זכויותיך" ("Your rights") and "שמירה" ("Retention"):
  - Self-service export and deletion at `/settings`, including what the export contains.
  - The signed-URL expiry for CV files.
  - Deletion is immediate and irreversible, and covers CV files, the account and anonymous sessions.
  - The 30-day CV storage lifecycle.
  - What sits outside our control (aggregate analytics with no identifiers; the LLM provider's processing).
- While touching this page, **move its strings into `he.privacy`**. It currently hard-codes Hebrew in violation of the i18n rule. This is small and in scope because we rewrite the text anyway.
- `CLAUDE.md`: add a short "#51 data rights" section (registry is the source of truth, coverage test, deletion order, the consent exemption). AGENTS.md says to edit `CLAUDE.md`/`AGENTS.md` only with approval, so propose the text in the PR description and let Moti approve before committing it.

## 4. Files to change

| File | Change |
|---|---|
| `lib/anonymous.ts` | + `resolveCurrentUserIds` (read-only) |
| `lib/privacy/{registry,identity,export,delete,rateLimit}.ts` | new |
| `app/api/me/route.ts`, `app/api/me/export/route.ts` | new |
| `app/(app)/settings/page.tsx`, `components/settings/*` | new |
| `lib/i18n/he.ts` | + `settings`, + `privacy` blocks |
| `lib/analytics.ts` | + `data_exported`, `account_deleted` events |
| `app/(marketing)/privacy/page.tsx` | content update + i18n move |
| `app/(app)/recommendations/…`, `app/page.tsx` | settings link |
| `supabase/migrations/<ts>_user_data_rights.sql` | new (file only) |
| `lib/db/types.gen.ts` | hand-add the column + RPC (regenerated later) |
| `scripts/verify-all-surfaces.mjs` | + `/settings` |
| `tests/mocks/fake-supabase.ts` | new in-memory fake (§5) |

Estimated ~900–1100 lines including tests, which is over the 800-line guideline. Split into **2 PRs**: (A) registry, coverage test, migration file, `lib/privacy`, the two routes and their tests; (B) settings UI, privacy page, i18n, analytics, smoke script.

## 5. Tests to write first

All Vitest. There is no real database: integration tests use an in-memory fake.

**`tests/mocks/fake-supabase.ts`**: a small in-memory store keyed by table, implementing:

- the subset of PostgREST we use: `select` / `eq` / `in` / `is` / `gt` / `lt` / `order` / `range` / `limit` / `update` / `delete` / `maybeSingle` / `single`;
- a configurable `max_rows = 1000` truncation, to prove pagination;
- `storage.from(b).list/remove/createSignedUrl`;
- `auth.admin.deleteUser`;
- `rpc("delete_user_data")` implemented in TS from the **same registry order**. The SQL itself is pinned statically by 5.1(c).

It supports fault injection (`failNext("storage.remove")`, etc.). It extends the spirit of `tests/mocks/supabase-chain.ts` but holds real rows, so we can assert that user A's data never leaks to user B.

### 5.1 `tests/unit/privacy/coverage.test.ts`: the guard the issue asks for

A small parser over `supabase/migrations/*.sql`, in test-local helpers with no dependencies:

- Extract every `create table [if not exists] [public.]<name> ( … )` with its column list, plus any `alter table <name> add column … references …`.
- A table is **user-scoped** if any of these holds:
  1. it is `users`;
  2. it has a column that `references [public.]users`;
  3. it references another user-scoped table (transitive fixpoint);
  4. it has a column named `user_id`, `auth_id` or `owner_id`, even without an FK.

Rule 4 catches a future table that forgets the FK.

Assertions:

- **(a)** The user-scoped set from migrations equals `Object.keys(USER_DATA_TABLES)` exactly. Message on failure: "table X holds user data but is not in lib/privacy/registry.ts — add export + delete handling".
- **(b)** Every table found in migrations is in `USER_DATA_TABLES` or in `NON_USER_TABLES`, so a new table needs a conscious classification either way.
- **(c)** The newest migration defining `delete_user_data` contains a `delete from public.<t>` for every registry table. The statement order respects the FK graph (children before parents), and `users` comes last.
- **(d)** Every `insert into storage.buckets` id found in migrations is a key of `STORAGE_BUCKETS`.
- **(e)** Every non-root registry table has an `on delete cascade` path to `users` (belt and braces for the auth-first cascade).
- **(f)** A parser self-test: the detected user-scoped set is snapshotted (the 14 tables in §2), and a synthetic SQL string with a new `create table foo (user_id uuid references users(id))` makes (a) fail. This proves the guard actually guards.

### 5.2 `tests/unit/privacy/registry.test.ts`

- `career_profile` has scope `user_id` (pins that orphans are covered).
- `anonymous_sessions.token` is in `redact`.

### 5.3 `tests/unit/anonymous-resolve.test.ts`

- Authed user with a row → returns that row, with no inserts and no updates (assert the fake's write log is empty).
- Authed user with no row plus a live `co_anon` → returns the anon row as primary, and does **not** promote it.
- Authed user with a row plus a `co_anon` pointing at a different unpromoted anon row → `linkedAnonymousId` is set.
- `co_anon` pointing at an already-promoted row → not linked.
- Anonymous with a live cookie → returns the row. Expired, missing or unknown cookie → `null`. Nothing is ever inserted.

### 5.4 `tests/integration/me-export-route.test.ts`

Seed **user A** (authed) and **user B** (anonymous) with rows in all 14 tables, plus 2 CV objects each. A has 1,500 messages, an orphan `career_profile` (`conversation_id = null`) and a linked one.

- **A's export** contains exactly A's rows in every table. **No row with B's id, or B's conversation/plan/session ids, appears anywhere** (deep scan of the JSON for B's uuids).
- All 1,500 messages are present (pagination).
- Both `career_profile` rows are present.
- Every registry key is present, and empty tables are `[]`.
- `anonymous_sessions.token` is redacted.
- Storage lists A's objects with signed URLs, including an object with no `cv_uploads` row. A `cv_uploads` row whose object is missing has `available: false`.
- **B's (anonymous) export** via cookie works and contains only B.
- `linked_anonymous` is populated in the stale-cookie scenario.
- No identity → 401, and the fake's write log shows no `users` insert.
- A second export within 60 s → 429 with `Retry-After`. After 60 s (fake clock) → 200.
- Headers: `attachment`, `no-store`, `nosniff`.
- `requireConsent` is **not** called. A user with revoked consent can still export.

### 5.5 `tests/integration/me-delete-route.test.ts`

Same seed as 5.4.

- Missing or wrong `confirmation` → 400, and nothing is deleted.
- Cross-origin `Origin` → 403.
- **Happy path, authed A**:
  - all of A's rows in all 14 tables are gone;
  - all of A's objects under `cv-uploads/A/` are gone, including the orphan object;
  - `auth.admin.deleteUser(A.auth_id)` is called once;
  - **every one of B's rows and objects is untouched** (exact count equality before and after);
  - the response clears `co_anon` and calls `signOut`;
  - the report counts match the seed.
- **Anonymous B**: rows and objects are gone, `deleteUser` is **not** called, and `co_anon` is cleared.
- **Orphan profiles**: both of A's `career_profile` rows (null and linked) are deleted.
- **Linked anon**: in the stale-cookie scenario, both A and the linked anon row are deleted.
- **Idempotent**: the same request a second time → 200 with zero counts, and `deleteUser` gets a 404 that is treated as `"absent"`.
- **Fresh account after re-login**: after deleting A, simulate sign-in with a new `auth_id` for the same email and call `getOrCreateAnonymousUserId` → it creates a new `users` row, and every user table filtered by the new id is empty.
- **Partial failures** (fault injection; each asserts the Sentry mock was called with `tags.stage`):
  - storage `remove` fails → 500 `stage: "storage"`, **all DB rows intact**, and a retry succeeds fully;
  - RPC fails → 500 `stage: "db"`, DB rows intact (rollback is simulated by the fake), and a retry succeeds;
  - `deleteUser` fails → 500 `stage: "auth"`, public rows gone, and a retry with the same session completes and calls `deleteUser` again;
  - the stage-2b sweep finds an object uploaded mid-delete → removed, and a sweep failure → still 200 with a Sentry warning.
- **Lock**: two concurrent requests → one 200, one 409. A stale lock older than 2 minutes is claimable.
- `requireConsent` is not called.

### 5.6 `tests/unit/components/DeleteAccountDialog.test.tsx` (RTL testing-library, jsdom)

- The confirm button is disabled until `מחק` is typed exactly.
- It sends `DELETE /api/me` with the `DELETE_MY_ACCOUNT` body.
- 409 and 500 show the matching `he.settings.delete.errors.*` text in `role="alert"`.
- The dialog cannot be dismissed while deleting.
- No raw Hebrew literals in the component: grep-style assertion that it imports from `he`.

### 5.7 Static checks

- `tests/unit/privacy/no-mbti-and-i18n.test.ts` (or extend the existing check): `components/settings/**` and `app/(marketing)/privacy/page.tsx` contain no Hebrew character ranges outside `lib/i18n`.

## 6. Risks and edge cases

| Risk | Mitigation |
|---|---|
| A new table is added later and not handled | Coverage test 5.1 fails CI with an actionable message. |
| The parser misses a table (unusual SQL formatting, e.g. unquoted table without `public.`) | Snapshot self-test 5.1(f), and the parser handles `if not exists`, optional schema and case-insensitivity. |
| Silent truncation at PostgREST's 1000-row cap | Pagination everywhere, plus the 1,500-message test. |
| Export or delete *creates* an account (calls `getOrCreateAnonymousUserId`) | A separate read-only resolver; tests assert no inserts. |
| Cross-user leakage via service role (RLS bypassed) | Every query is built from the registry with an owner filter. A two-user deep-scan test. Child tables are only queried with parent ids we own. |
| Concurrent writes during deletion (a chat stream finishing, a CV upload) | DB inserts after stage 2 fail on the FK, which is acceptable: the engine logs them and Sentry captures them. The storage sweep (2b) plus the 30-day lifecycle handle late objects. The lock prevents double deletion. |
| The auth delete succeeds but the response is lost | The retry path treats "credential present, nothing left" as 200. |
| Long export (many rows) exceeds 30 s | Bounded by realistic data (beta users). `maxDuration = 30`. If needed later, stream the JSON (follow-up). |
| Signed URL leaks if the export file is shared | 15-minute expiry, stated in the export notice. |
| Hand-written `types.gen.ts` drifts from the generator | Mirror the generator format exactly, and regenerate when the migration ships (expect an empty diff). |
| `revoke` missed on the new SECURITY DEFINER function | Included in the same migration. Extend the coverage test: every `security definer` function in the migrations has a matching `revoke execute … from public, anon, authenticated`. |
| Deleting consents removes our proof of the user's past consent | Accepted. Erasure of the person outweighs it, and no lawful-basis record is needed once there is no data. Flag for the lawyer review in the Phase 7 checklist. |
| The consent-exemption deviates from AGENTS.md rule 3 | Documented in the route comment and §3.3, and called out for the critique. |
| Middleware-race anonymous rows nobody can claim | Out of scope; follow-up retention-sweep issue. |
| `/settings` is reachable for a visitor with no data | Shows the empty state. Delete returns 401, and export returns 401 → toast. |

## 7. Rollback

- **Code**: both PRs are additive (new routes, new modules, new page). Reverting them removes the feature without affecting existing flows. The only edits to existing behaviour are a new exported function in `lib/anonymous.ts` (existing functions untouched), new i18n keys, and new analytics union members.
- **Kill switch**: an env flag `DATA_RIGHTS_ENABLED` (default `true`). When `false`, both routes return 503 and the settings panel shows "פנה ל־privacy@…" ("Contact privacy@…"). This lets us disable a misbehaving delete in production without a redeploy of reverted code.
- **Migration**: additive only (one nullable column plus one function). The down path, if ever needed, is a new migration: `drop function public.delete_user_data(uuid); alter table public.users drop column last_export_at;`. Migrations are immutable once applied, so we never edit this file.
- **Deleted data cannot be rolled back** by design. That is why the confirmation step, the lock and the storage-first, auth-last ordering exist, and why the fault-injection tests must pass before merge.

## 8. Out of scope

- Emailing the export (needs Resend; Phase 5c.5).
- A grace period or scheduled deletion (the issue asks for a hard delete).
- Admin-initiated deletion on behalf of a user (handle manually via the same `deleteUserData` from a script if needed; follow-up).
- Retention sweep for unclaimable anonymous rows (follow-up issue).
- IP-level rate limiting (Phase 7 / Vercel firewall).
