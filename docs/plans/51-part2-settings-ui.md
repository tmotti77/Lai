# Plan — #51 part 2: settings UI, privacy page, a11y

> Issue: [#51](https://github.com/tmotti77/Lai/issues/51). Part 1 (backend) merged as #54.
> Branch: `feat/51-settings-privacy-ui`
> Parent plan: `docs/plans/51-data-export-delete.md` §3.7, §3.8, §5.6, §5.7. Critique: `docs/plans/51-data-export-delete-critique.md`.
> Status: plan only.

## 1. Scope

Part 1 shipped `GET /api/me/export`, `DELETE /api/me`, `lib/privacy/*`, the analytics events and the coverage test. Part 2 adds the user-facing surface: `/settings`, the export and delete UI, entry links, the privacy page rewrite, i18n, a11y, and the smoke-script entry. **No API, migration, `CLAUDE.md` or `AGENTS.md` changes.**

Critique item 6 (run `delete_user_data` against a real Postgres before applying the migration) is still open. It gates applying the migration, not this PR. The UI is harmless while the function is missing: delete returns 500 `deletion_incomplete` and the dialog shows the retry banner.

## 2. Facts from the merged code that shape this plan

| Fact | Where | Consequence |
|---|---|---|
| `DELETE_CONFIRMATION = "DELETE_MY_ACCOUNT"` lives in `lib/privacy/delete.ts`, which imports `server-only` | `lib/privacy/delete.ts:1,12` | The client can't import it. Move the constant to a new client-safe `lib/privacy/constants.ts` and re-export it from `delete.ts`, so there is one source of truth. |
| `data_exported` and `account_deleted` already exist in `EventName`/`EventPropsMap` and are tracked server-side by the routes | `lib/analytics.ts:16-17,45-46` | **No new analytics events.** Client-side tracking would double-count. |
| `he.settings` already exists with `export.fileNotice`, which the export bundle uses | `lib/i18n/he.ts:521`, `lib/privacy/export.ts:173` | Extend the block; keep `export.fileNotice` unchanged. |
| The proxy mints an anonymous user on every page except `/api/me*` | `lib/supabase/middleware.ts:19,44-52` | A first visit to `/settings` already has an (empty) identity, so the "no data" state is close to unreachable. Keep it as a fallback. After a delete, navigating to `/?deleted=1` mints a fresh, empty anon identity. This is the expected "fresh account" behaviour. |
| `resolveRequestIdentity()` throws `SessionRejectedError` / `AuthUnavailableError`, and `dataRightsEnabled()` is the kill switch | `lib/privacy/identity.ts` | The page has 5 render states (§3.1). |
| Export errors: 429 `rate_limited` (+`retry_after_s`, 60 s), 401 `session_expired` / `no_identity`, 503 `disabled` / `auth_unavailable`, 500 `storage_unavailable` / `internal`. On 200: JSON attachment, filename in `content-disposition` | `app/api/me/export/route.ts` | Map to toasts (§3.3). |
| Delete: 200 `{deleted, complete, report}` (`complete:false` is still success). Errors: 400 `confirmation_required`, 403 `bad_origin`, 401 `session_expired` / `no_identity`, 409 `deletion_in_progress` (+`retry_after_s`), 500 `deletion_incomplete` (`retryable`) / `internal`, 503 `disabled` / `auth_unavailable` | `app/api/me/route.ts` | Map to inline alerts (§3.4). |
| `DialogContent` always renders a Radix `Close` X with a hard-coded English `sr-only` "Close" | `components/ui/dialog.tsx` | Guard `onOpenChange` while deleting, and add an optional `hideClose` prop (default `false`, so existing dialogs are unchanged). The English label is a pre-existing issue; out of scope. |
| `Button` styles only `disabled:`. Focus ring is `focus-visible:ring-1` | `components/ui/button.tsx:8` | For `aria-disabled` add the class `aria-disabled:opacity-50 aria-disabled:cursor-not-allowed` at the call site. |
| Toasts: `sonner` `<Toaster dir="rtl">` is mounted in `app/layout.tsx`. Pattern: `toast.error(he.…)` | `components/plan/PlanClient.tsx` | Reuse. |
| Tests: Vitest `environment: "node"`. Component tests opt in with a `@vitest-environment jsdom` docblock. `@testing-library/react` + `jest-dom` are installed; `user-event` is **not** | `vitest.config.ts`, `tests/unit/components/MessageBubble.test.tsx` | Use `fireEvent`. Mock `fetch` with `vi.stubGlobal`. Don't add deps. |
| No existing "no Hebrew outside i18n" static test | `tests/unit` | New test (§4.4). |
| Weekly encrypted DB backups are kept 90 days | `.github/workflows/*backup*` (`retention-days: 90`, #56) | The privacy page must say that deleted data can persist in encrypted backups for up to 90 days. The parent plan missed this. |
| `scripts/verify-all-surfaces.mjs` has a `SURFACES` array and already POSTs `/api/consent` | lines 38-53, 80 | Add one entry. `/settings` doesn't need consent anyway. |

## 3. Design

### 3.1 `app/(app)/settings/page.tsx` (RSC, `dynamic = "force-dynamic"`)

- Does **not** call `getOrCreateAnonymousUserId` or `requireConsent`. Same exemption as the routes: data rights don't depend on consent.
- It calls `resolveRequestIdentity()` inside a try/catch and renders exactly one of these states:
  1. `!dataRightsEnabled()` → `he.settings.disabled` (contact `he.privacy.contactEmail`). No buttons.
  2. `SessionRejectedError` → `he.settings.sessionExpired` + a link to `/sign-in`.
  3. `AuthUnavailableError` / other error → `he.settings.loadError` (`role="alert"`). Report it to Sentry with `tags.context = "settings_page"`.
  4. `!ids && !authUser` → `he.settings.noData`.
  5. Otherwise → `<DataRightsPanel isAnonymous={ids?.isAnonymous ?? false} />`. `ids` is null for an auth-only account, which is still signed in, so `isAnonymous` is false.
- Layout: `mx-auto max-w-2xl px-4 py-8`, an `h1` from `he.settings.title`, an intro paragraph, and a link to `/privacy`.
- `export const metadata = { title: he.settings.title }`.

### 3.2 `components/settings/useDataExport.ts` (client hook)

`useDataExport() → { exporting: boolean, start(): Promise<void> }`. Both the panel button and the inline link in the dialog use it.

- `fetch("/api/me/export", { cache: "no-store" })`.
- On 200: `await res.blob()`, take the filename from `content-disposition` (fallback `careeros-export.json`), then `URL.createObjectURL` → a temporary `<a download>` → `click()` → `revokeObjectURL`. Show `toast.success(he.settings.export.success)`.
- On non-200: parse `{error}` with a safe `json().catch(() => ({}))` and call `toast.error(exportErrorMessage(status, error, retry_after_s))`.
- On network failure: `toast.error(he.settings.export.errors.generic)`.
- Re-entry is guarded by `exporting`.

`exportErrorMessage` is a pure function in `components/settings/messages.ts`, so it can be unit-tested. 429 → `rateLimited(seconds)`; 401 `session_expired` → `sessionExpired`; 401 `no_identity` → `noData`; 503 → `unavailable`; anything else → `generic`.

### 3.3 `components/settings/DataRightsPanel.tsx` (client)

Props: `{ isAnonymous: boolean }`. Two `Card` sections:

- **Export**: heading, a description of what the file contains and the 15-minute CV-link expiry, and `<Button onClick={start} disabled={exporting}>`. The label switches to `he.settings.export.loading` while exporting. The button is a `<button>`, not `<a href>`, so a 429 can show feedback.
- **Delete**: heading, description, and `<Button variant="destructive">` that opens `DeleteAccountDialog` (`open`/`onOpenChangeAction` controlled). Return focus to the trigger on close; Radix does this by default.
- If the user arrives with `?deleted=1`, do nothing here. That notice belongs to the home page (§3.6).

### 3.4 `components/settings/DeleteAccountDialog.tsx` (client)

Props: `{ open, onOpenChangeAction, isAnonymous }`. Use the `Action` suffix (Next 16 RSC lint 71007, same as `SaveReportDialog` callers).

State: `phase: "idle" | "deleting" | "error"`, `typed: string`, `errorMessage: string | null`.

- **Content**: `DialogTitle` + `DialogDescription` (irreversible). A `<ul>` of what will be deleted (`he.settings.delete.items`; the `account` item renders only when `!isAnonymous`). An "export first" line with an inline button that calls `useDataExport().start`.
- **Typed confirmation**: `<label htmlFor="delete-confirm">` with `he.settings.delete.typeToConfirm` (containing the word `מחק`), plus `<Input id="delete-confirm" autoComplete="off" dir="rtl">`. `canConfirm = typed.trim() === he.settings.delete.confirmWord`. Exact match after trimming whitespace.
- **Confirm button**: `variant="destructive"`, **`aria-disabled={!canConfirm || deleting}`** (not `disabled`, so it stays focusable and announced). The click handler no-ops when aria-disabled. `aria-describedby` points at the label text. It shows a spinner + `he.settings.delete.deleting` while deleting.
- **Request**: `fetch("/api/me", { method: "DELETE", headers: {"content-type": "application/json"}, body: JSON.stringify({ confirmation: DELETE_CONFIRMATION }) })`, importing from `lib/privacy/constants.ts`.
- **On 200** (whatever the value of `complete`): `window.location.assign("/?deleted=1")`. Use a full navigation so the dead session and anon cookies are dropped from all client state. Stay in `deleting` until the page unloads.
- **On error**: `phase = "error"`, and `errorMessage = deleteErrorMessage(status, error)` from `messages.ts`. 409 → `inProgress`; 401 `session_expired` → `sessionExpired`; 401 `no_identity` → `noData`; 503 → `unavailable`; 500 `deletion_incomplete` → `incomplete`; else → `generic`. Render it as a persistent `<div role="alert">` above the footer with a "נסה שוב" ("Try again") button, which re-sends with the same typed value.
- **Non-dismissable while deleting**: `onOpenChange={(o) => { if (!deleting) onOpenChangeAction(o) }}`, `onEscapeKeyDown` / `onInteractOutside` → `preventDefault()` when deleting, `hideClose={deleting}`, and the cancel button gets `disabled` when deleting.
- **Focus**: `onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus() }}`. Without this, Radix would focus the inline export button first.
- **Reset** `typed`/`phase`/`errorMessage` when the dialog closes.
- RTL: `text-start`, `ms-*` / `me-*`, `DialogFooter` as is. Add `focus-visible:ring-2` on the inline export button if it is a raw `<button>`.

### 3.5 Entry links

- `components/recommendations/RecommendationsClient.tsx`: `<Button asChild size="sm" variant="ghost"><Link href="/settings">{he.settings.entryLink}</Link></Button>` in the action row next to "שמור דוח" ("Save report") / PDF.
- `app/page.tsx` footer: under the disclaimer, `Link`s to `/settings` and `/privacy`, styled like the existing `home.nav` links.
- Privacy page: "לניהול הנתונים שלך" ("To manage your data") → `/settings` (§3.7).

### 3.6 Home `?deleted=1` notice

`app/page.tsx` becomes `async ({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> })` (Next 16: `searchParams` is a Promise). When `deleted === "1"`, render a `<p role="status">` banner with `he.settings.delete.deletedNotice` above the hero. Plain RSC, no client JS.

### 3.7 Privacy page `app/(marketing)/privacy/page.tsx`

Move every string into a new top-level `he.privacy` block: `title`, `version`, and `sections: { collected, use, rights, retention, outsideControl }`, each `{ heading, body }` or `{ heading, items[] }`, plus `contactEmail` and `manageLink`. The page maps over them and keeps the `prose prose-sm` article.

Content changes:
- **Rights**: self-service export and deletion at `/settings` (link). Explain what the export contains (same list as `fileNotice`), that the CV download links expire after 15 minutes, and that withdrawing consent doesn't block export or deletion. The email is kept only as a fallback.
- **Retention**: deletion is immediate and irreversible, and covers conversations, questionnaires, CV files, recommendations, plans, interviews, feedback, consents, the anonymous session and the account. CV files are also auto-deleted after 30 days. **Encrypted backups are kept up to 90 days, after which deleted data no longer exists in them.** Downloaded reports and exports stay on the user's device.
- **Outside our control**: aggregate analytics without identifiers (which can't be linked to the user, so they aren't deleted), and processing by the LLM provider under its own retention terms.
- Bump the version line (`0.2`), still marked "טיוטה, לפני סקירה משפטית" ("Draft, before legal review").

### 3.8 `he.settings` additions (`lib/i18n/he.ts`)

```
settings: {
  title, intro, entryLink, privacyLink, noData, disabled, sessionExpired, signInAgain, loadError,
  export: { fileNotice /* existing */, heading, description, button, loading, success,
            errors: { rateLimited /* "...{seconds}..." */, sessionExpired, noData, unavailable, generic } },
  delete: { heading, description, openButton, dialogTitle, dialogDescription,
            items: { conversations, assessments, cv, recommendations, plans, interviews, feedback, account },
            exportFirst, exportFirstButton, confirmWord: "מחק", typeToConfirm, confirmButton,
            cancel, deleting, retry, deletedNotice,
            errors: { inProgress, sessionExpired, noData, unavailable, incomplete, generic } },
}
```

`rateLimited` uses a `{seconds}` placeholder, which `messages.ts` replaces. This matches the existing `{current}` / `{when}` / `{date}` convention; `he.ts` has no function-valued keys. The ASCII token never appears in `he.ts`.

### 3.9 Smoke script

In `scripts/verify-all-surfaces.mjs`, add `{ path: "/settings", name: "settings" }` to `SURFACES` and update the "Visits 14 app surfaces" header comment to 15. Optional, if cheap in the script's structure: one extra pass that opens the delete dialog and runs axe on it. **Never click confirm.**

## 4. Tests to write first

All Vitest. Component tests use the `@vitest-environment jsdom` docblock, `fireEvent`, and `vi.stubGlobal("fetch", …)`. Mock `sonner` with `vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))`.

### 4.1 `tests/unit/components/DeleteAccountDialog.test.tsx` (parent §5.6)
- The input has focus on open, and the confirm button has `aria-disabled="true"`. Clicking it doesn't call `fetch`.
- Typing `מח` keeps it disabled. Typing ` מחק ` enables it (trimmed). Typing `delete` keeps it disabled.
- Confirm sends `DELETE /api/me` with body `{"confirmation":"DELETE_MY_ACCOUNT"}` and a JSON content-type.
- While the request is pending (a never-resolving promise): Escape and the cancel button don't call `onOpenChangeAction(false)`, and the close X isn't rendered.
- 409 → `he.settings.delete.errors.inProgress` in `role="alert"`. 500 `deletion_incomplete` → `incomplete`. 401 `session_expired` → `sessionExpired`. A rejected fetch → `generic`. The retry button re-sends.
- 200 with `complete: false` → `window.location.assign("/?deleted=1")` (stub `location.assign`).
- `isAnonymous` toggles the `account` list item.

### 4.2 `tests/unit/components/DataRightsPanel.test.tsx`
- Export 200 → `createObjectURL` is called with a Blob, the anchor's `download` equals the `content-disposition` filename, `revokeObjectURL` is called, and `toast.success` fires. Stub `URL.createObjectURL` / `revokeObjectURL`.
- Export 429 → `toast.error` with the `rateLimited` text containing `60`. 401 `no_identity` → `noData`. 503 → `unavailable`.
- The button is disabled while exporting, and a double click makes one fetch.
- The delete button opens the dialog (its title becomes visible).

### 4.3 `tests/unit/settings/messages.test.ts`
Table-driven over every status/error pair listed in §2 for both mappers. This pins the client to the real route contract.

### 4.4 `tests/unit/privacy/no-hebrew-outside-i18n.test.ts` (parent §5.7)
Read `components/settings/**/*.tsx?`, `app/(app)/settings/page.tsx` and `app/(marketing)/privacy/page.tsx`. Assert that no character is in `/[֐-׿]/`, and that each file imports `@/lib/i18n/he`.

### 4.5 `tests/unit/privacy/constants.test.ts`
`lib/privacy/constants.ts` has no `server-only` import, and `DeleteRequestBody` (from `delete.ts`) accepts `{ confirmation: DELETE_CONFIRMATION }`, which guards the move.

### 4.6 Settings page states
`tests/unit/settings/page.test.tsx` (jsdom). Mock `@/lib/privacy/identity` and render `await SettingsPage()`. Cover these cases: kill switch → `disabled`; `SessionRejectedError` → `sessionExpired` + `/sign-in` link; `AuthUnavailableError` → `loadError` alert; no ids and no auth → `noData`; auth-only → panel without `isAnonymous`. If rendering an async RSC in jsdom is awkward, extract `settingsViewState(identityResult)` as a pure function and test that instead.

Keep the existing tests green: `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run lint`.

## 5. Files

| File | Change |
|---|---|
| `lib/privacy/constants.ts` | new: `DELETE_CONFIRMATION` |
| `lib/privacy/delete.ts` | import and re-export the constant (one line) |
| `app/(app)/settings/page.tsx` | new |
| `components/settings/{DataRightsPanel,DeleteAccountDialog}.tsx`, `useDataExport.ts`, `messages.ts` | new |
| `components/ui/dialog.tsx` | optional `hideClose` prop on `DialogContent` |
| `components/recommendations/RecommendationsClient.tsx` | settings link |
| `app/page.tsx` | footer links + `?deleted=1` notice |
| `app/(marketing)/privacy/page.tsx` | rewrite, strings → `he.privacy` |
| `lib/i18n/he.ts` | extend `settings`, add `privacy` |
| `scripts/verify-all-surfaces.mjs` | + `/settings` |
| `tests/unit/...` | §4 |

Estimate: ~350 source + ~350 test lines, within the 800-line guideline.

## 6. Manual verification before the PR

1. `npm run dev`. As an anonymous user, chat once, open `/settings`, export (file downloads, JSON opens), and export again within 60 s (rate-limit toast).
2. Delete flow: Tab order, Escape blocked while deleting, lands on `/?deleted=1` with the notice, `/settings` again shows an empty fresh identity. Run against a branch or local DB only (critique item 6), never the shared project until the function is verified.
3. Signed-in user: the account item is listed. After the delete, the session is gone.
4. Set `DATA_RIGHTS_ENABLED=false`: `/settings` shows the contact message.
5. `node scripts/verify-all-surfaces.mjs`: zero critical/serious axe findings on `/settings` and `/privacy` at 375/768/1280.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A user deletes by accident | Typed `מחק`, an explicit list, an "export first" prompt, and an `aria-disabled` confirm |
| Double-submit or closing mid-delete leaves the user unsure | Non-dismissable while deleting; the server lock returns 409 → `inProgress` text |
| Client token drifts from the server schema | Single constant in `lib/privacy/constants.ts` + test 4.5 |
| The privacy page overstates erasure | It states the 90-day backups, aggregate analytics and LLM provider terms explicitly. Lawyer review in Phase 7 |
| `/settings` visit mints an anon row (proxy) | Accepted. It's identical to visiting any other page. The row is empty and the user can delete it |

## 8. Out of scope

`CLAUDE.md` / `AGENTS.md` edits (already contain the #51 section), migrations, API changes, a global nav/header, emailing the export, translating the dialog's built-in English "Close" label, and consent withdrawal UI.
