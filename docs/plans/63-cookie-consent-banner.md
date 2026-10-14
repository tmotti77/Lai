# Plan — #63: cookie / analytics consent banner

> Issue: [#63](https://github.com/tmotti77/Lai/issues/63). Roadmap Phase 7 (cookie consent banner) + launch-expert packet.
> Branch: `feat/cookie-consent`
> Status: plan only. No code written yet.
> Amended after critique ([`63-cookie-consent-banner-critique.md`](./63-cookie-consent-banner-critique.md)): dropped the header-stripping code change for server `track()` (the installed SDK copies the request URL into the payload regardless of headers passed, so "no browser identifiers" was an unverifiable claim — see Decision 4); gave `writePreference` an explicit persistence-success contract (Decision/Step 1); switched the banner from a fixed overlay to a normal-flow layout row, which removes the `ResizeObserver`/CSS-variable/composer-offset machinery entirely (Decision 7, Step 3); made both banner buttons the same variant (Decision 8); aligned the banner's accessible name to its visible title; added unit/component tests for revoke, storage-throw, and essential-only not substituting processing consent (Steps 1, 2, 4); dropped the `CLAUDE.md` edit from Step 4; and listed interactive browser flows (script injection/removal, revoke mid-load, cross-tab) as a manual checklist, since this repo's only Playwright usage is the existing a11y smoke script, not an interactive-flow test suite.

## 0. Context map

### Key files

| File | Role today | Change in this plan |
|---|---|---|
| `app/layout.tsx:3,28` | Root layout. Mounts `<Analytics />` from `@vercel/analytics/next` **unconditionally**, plus `<Toaster>` | Replace with a consent-gated wrapper, and mount the banner (steps 2, 3) |
| `lib/analytics.ts` | Server `track()` → `@vercel/analytics/server` via `after()`. No-ops when `NODE_ENV === "test"` | Strip browser identifiers from server events (step 2) |
| `node_modules/@vercel/analytics/dist/server/index.mjs:88-131` | Server `track` reads the request context and forwards **`cookie`, `user-agent`, `x-forwarded-for`** to Vercel | Why step 2 overrides the headers |
| `components/chat/ConsentDialog.tsx` | DB consent (processing + disclaimer) modal, `/api/consent`. Mounted by `ChatShell` | **Untouched.** A separate concern; never merge the two |
| `lib/consent.ts` | Server `requireConsent` purposes | **Untouched** (out of scope) |
| `lib/anonymous.ts:5` | `ANON_COOKIE_NAME = "co_anon"` (essential) | Read-only reference for privacy copy |
| `lib/supabase/middleware.ts` | Sets `co_anon` + Supabase `sb-*` auth cookies (essential) | Read-only reference |
| `app/(app)/settings/page.tsx` | RSC with 5 view states and `DataRightsPanel` | Add a cookie-preferences card, rendered in **every** view state (step 4) |
| `app/(marketing)/privacy/page.tsx` | Renders `he.privacy.sections` | Copy-only change through `he.ts` (step 4) |
| `lib/i18n/he.ts` (`settings` at 521, `privacy` at 587) | All Hebrew strings | New `cookieConsent` block, plus a privacy section (steps 3, 4) |
| `components/chat/ChatShell.tsx`, `components/interview/InterviewChat.tsx`, `components/cv/CvReview.tsx` | `h-dvh` / `fixed bottom-0` bottom-anchored surfaces | **Untouched.** The banner renders in normal document flow (Decision 7), not fixed, so nothing needs a composer offset |
| `tests/unit/privacy/no-hebrew-outside-i18n.test.ts` | Hebrew-literal guard for settings/privacy files | Add the new component globs (step 3) |
| `tests/unit/analytics.test.ts` | Mocks `@vercel/analytics/server` + `next/server` `after` | Extend for header stripping (step 2) |
| `scripts/verify-all-surfaces.mjs` | 15 surfaces × 3 viewports + axe | Banner is now on every surface. Run it as the a11y and overlap check |

### Entry points

- Every page goes through `app/layout.tsx` → banner + gated analytics.
- `/settings` → change the choice at any time.
- `/privacy` → explains essential vs analytics storage, and is linked from the banner.

### Commands (same as CI, `.github/workflows` lines 18-29)

```bash
npm run lint                                   # eslint
npx tsc --noEmit                               # typecheck
npm test                                       # vitest run (all)
npx vitest run tests/unit/cookie-consent       # step-scoped run
npx vitest run tests/unit/components/CookieBanner.test.tsx
npm run build                                  # CI also builds
node scripts/verify-all-surfaces.mjs           # manual: axe + 375/768/1280 check (needs `npm run dev`)
```

Interactive browser flows that no unit/component test can cover (script injection/removal timing, revoke-while-the-Vercel-script-is-loading, cross-tab revoke, a production-preview check of the actual outbound `track()` payload) are **manual verification only** — see the checklist at the end of Step 2. This repo's only Playwright usage is `scripts/verify-all-surfaces.mjs` (axe smoke test over static navigation); there's no interactive-flow Playwright suite, and adding one is out of scope for this plan.

Test conventions: Vitest defaults to `environment: "node"`. Component tests opt in with a `/** @vitest-environment jsdom */` docblock. `@testing-library/react` + `jest-dom` are available, `user-event` is **not**, so use `fireEvent`. Don't add dependencies.

## 1. Decisions

1. **Storage is localStorage only, with no new cookie.** Key `careeros.cookieConsent`, value `{ v: number, analytics: boolean, at: ISO string }`. The server never needs the choice (decision 4). A cookie would add a request-time read to every route for no benefit. If storage is unavailable (private mode, blocked storage), the choice lives in memory for the tab, and the banner re-shows on the next visit. That's acceptable and conservative. See the precedence contract in Step 1 for exactly how the in-memory fallback and real storage interact.
2. **Versioning:** `COOKIE_CONSENT_VERSION = 1`. A stored `v` that differs, malformed JSON or a wrong shape is all treated as "no choice", so the banner re-shows. Bump the version whenever a new non-essential category or vendor is added.
3. **Default is deny.** Until the user picks "accept analytics", `<Analytics />` is not mounted, so the Vercel script is never injected. If the user ignores the banner, the app works fully and analytics stays off.
4. **Server `track()` is left unchanged and documented as a best-effort cookieless aggregate, not gated on the browser choice.** Two options were weighed:
   - (a) Leave `track()` unmodified, and simply document its actual properties.
   - (b) Gate `track()` itself on the user's analytics choice, which requires the server to read that choice — i.e. a new consent cookie, re-introducing the cookie this plan set out to avoid (decision 1), plus a version-bump/migration path for it.
   This plan picks **(a)**. The critique found that passing an explicit `headers` override to `vercelTrack` (the original plan's approach) does **not** establish "no browser identifiers" as a testable guarantee: the installed `@vercel/analytics/server` SDK independently copies `requestContext.url` — which can include query strings — into the outbound payload regardless of which headers are passed, and that behavior lives in `node_modules`, not in app code, so it can change on any dependency bump and a unit test that mocks `vercelTrack` cannot observe it. Rather than ship a header-stripping change that *looks* like a privacy guarantee but isn't verified against the real SDK, this plan makes **no code change** to `lib/analytics.ts` and instead: (i) removes the "no browser identifiers" claim from the privacy copy (step 4) in favor of describing `track()` honestly as server-side aggregate counters with allowlisted, PII-free event names and props (`EventPropsMap` already enforces this at compile time); (ii) adds a code comment on `lib/analytics.ts`'s `track()` noting the open risk (request URL/query string may be forwarded by the SDK) and that no route tracked today puts sensitive data in its own URL — an invariant any future `track()` call site must preserve; (iii) lists a **manual** production-preview check (open the Vercel Analytics dashboard after a real request, inspect what reached it) as the only way to verify the SDK's actual behavior, rather than asserting it's covered by tests. Because of this, server events are **not** gated on the banner choice — they already don't depend on it.
5. **Revoke takes effect without a reload.** Once the Vercel script has been injected, unmounting `<Analytics>` doesn't remove it. So the wrapper also passes `beforeSend`, which re-reads the live preference on every event and returns `null` when analytics isn't granted. On the next full load, the script isn't injected at all. Whether the already-injected script's own network beacons stop immediately, versus just having their payloads nulled by `beforeSend`, and whether a revoke mid-script-load behaves the same way, is **not provable by a component test that mocks the SDK** — it's listed as a manual check in Step 2.
6. **The banner is non-modal and renders in normal document flow (not fixed, no overlay).** It's a `<section role="region" aria-labelledby="cookie-banner-title">`, rendered as an ordinary block above `{children}` in the root layout — no `position: fixed`, no `z-index` stacking concern, no backdrop, no focus trap, no `aria-modal`. `ConsentDialog` on `/chat` is a Radix dialog and, being a portal with its own overlay, still sits on top of normal page content regardless of the banner's position; it's still completed first in practice because it blocks interaction with the page underneath it via its own `aria-modal` trap, which is unaffected by where the banner lives in the DOM.
7. **The banner never covers the composer, because it never overlaps anything.** Rendering it in normal flow (decision 6) means it occupies real space at the top of the page and pushes everything below it down, the same way any other block element does. This replaces the original fixed-bottom-bar design, which needed a `ResizeObserver` publishing `--cookie-banner-h`, a `globals.css` padding rule, and class changes to three separate bottom-anchored surfaces (`ChatShell`, `InterviewChat`, `CvReview`) to avoid covering their composer/save bar. The critique flagged that approach as needing dedicated coverage for short screens, zoom and an open on-screen keyboard; the normal-flow layout removes the failure mode instead of adding tests for it, at the cost of pushing content down by the banner's height on first visit (acceptable — it's temporary, until a choice is made).
8. **Equal-weight buttons, no dark pattern.** "אישור סטטיסטיקות" ("Accept analytics") and "רק חיוניות" ("Essential only") use the **same** variant and size (`variant="secondary"`, side by side, each `min-h-11` = 44px) — the original plan's `outline` + default pairing was itself a spec conflict the critique caught (that pairing visually emphasizes one button, contradicting "equal weight"). There's no close X, so dismissing without a choice isn't a third, ambiguous state. Ignoring the banner equals deny, per decision 3.
9. **The banner's accessible name is its visible title, not a separate string.** The original plan defined a `regionLabel` i18n key for the `aria-labelledby` target while the banner's actual heading used a different `title` string — the critique caught the mismatch. `aria-labelledby` now points at the `<h2>` that renders `he.cookieConsent.title` directly; there is no separate `regionLabel` key. Tests query by that same visible title text.

## 2. Steps

### Step 1 — Pure preference helper + store

**Files (new):**
- `lib/cookie-consent/preference.ts`, client-safe (no `server-only`, no React):
  - `COOKIE_CONSENT_VERSION`, `COOKIE_CONSENT_STORAGE_KEY`, and the `CookiePreference` type.
  - `readPreference(storage: Pick<Storage,"getItem"> | null): CookiePreference | null`. Returns null for missing / malformed / wrong-version / throwing storage.
  - `writePreference(storage, analytics: boolean, now: Date): { preference: CookiePreference; persisted: boolean }`. Never throws. Attempts `storage.setItem`; on success returns `{ preference, persisted: true }`. On a thrown quota/security error, or a null `storage`, it swallows the error and returns `{ preference, persisted: false }` — the **caller** (the store, below) is the only thing allowed to decide what `persisted: false` means, so the helper itself makes no claim about whether the value is "really" saved.
  - `clearPreference(storage)`.
- `lib/cookie-consent/store.ts`: a tiny external store for `useSyncExternalStore`, with an explicit **precedence contract**:
  - Internal state is `{ memory: CookiePreference | null, memoryIsOverride: boolean }` plus whatever `readPreference(localStorage)` currently returns.
  - **Precedence contract:** if `writePreference` returned `persisted: true`, the in-memory override is cleared (storage is now the single source of truth again) and `getStatus()` reads from storage. If it returned `persisted: false`, `memoryIsOverride` is set `true` and `getStatus()` serves `memory` for the rest of the tab's lifetime, **ignoring** whatever is in storage (including a stale prior choice) until either (a) a successful write happens, or (b) a genuine cross-tab `storage` event fires — which **does** clear the override, because a `storage` event only fires for a real, successful write from another tab, so it's evidence storage is usable again. A reload with no new write re-reads storage from scratch (the override was only ever in-memory) — this is unavoidable and on dropdown documented behavior, not a bug: a failed write means the user's choice silently does not survive their own reload, so the banner may re-show after a refresh if the prior write failed. This is the known, accepted trade-off of "never throw"; it is not hidden from the user because `writePreference`'s `persisted` flag is surfaced up to the UI (step 3) as a one-line inline notice when `persisted === false`.
  - `getStatus(): "unset" | "granted" | "denied"`, a string snapshot so identity stays stable.
  - `getServerStatus(): "unknown"`. The SSR and hydration snapshot, so the server never renders the banner and there's no hydration mismatch.
  - `setAnalyticsConsent(granted)` calls `writePreference`, applies the precedence contract above, then dispatches `careeros:cookie-consent` on `window` with `{ persisted }` in `detail`.
  - `subscribe(cb)` listens to that event **and** `storage`, for cross-tab sync.
  - `hasAnalyticsConsent()`, the boolean used by `beforeSend`.
- `lib/cookie-consent/useCookieConsent.ts`: `useSyncExternalStore(subscribe, getStatus, getServerStatus)`.

**Test:** `tests/unit/cookie-consent/preference.test.ts` (node env, a fake `Map`-backed storage):
- A round-trip persists `analytics: true/false`; `writePreference` returns `persisted: true`.
- Version mismatch → null, so the banner re-shows. Malformed JSON → null. Wrong shape (`analytics: "yes"`) → null.
- `getItem` throwing → `readPreference` returns null. `setItem` throwing → `writePreference` returns `persisted: false` and still returns the attempted `preference` value; it does not throw.
- `clearPreference` → null.

**Test:** `tests/unit/cookie-consent/store.test.ts` (jsdom), covering the precedence contract directly (critique P2):
- **Stored grant → failed revoke write**: seed storage with `analytics:true`; stub `setItem` to throw; call `setAnalyticsConsent(false)`. Assert `getStatus()` is now `"denied"` (memory override wins) even though `readPreference(localStorage)` still returns the stale `analytics:true`, and the emitted event's `detail.persisted` is `false`.
- **The `window.localStorage` getter throwing** (not just `setItem`/`getItem` on an existing object — some privacy modes throw on the property access itself): `getStatus()` and `setAnalyticsConsent` don't throw; both fall back to the in-memory path.
- **Storage clearing**: after a successful write, directly clear the backing storage (simulating the user clearing site data) and fire a `storage` event with `newValue: null`; `getStatus()` returns `"unset"`.
- **Reload persistence**: after a *successful* write (`persisted: true`), a fresh module instance (simulating a reload) reading the same storage object sees the persisted value, not `"unset"`.
- `setAnalyticsConsent` notifies subscribers. A `storage` event from another tab notifies and clears any in-memory override per the precedence contract above. `getServerStatus` is `"unknown"`.

### Step 2 — Gate client Analytics; strip identifiers from server events

**Files:**
- New `components/cookie-consent/ConsentedAnalytics.tsx` (`"use client"`). It uses `useCookieConsent()`, renders `<Analytics beforeSend={(e) => (hasAnalyticsConsent() ? e : null)} />` only when the status is `"granted"`, and renders `null` for `unknown` / `unset` / `denied`.
- `app/layout.tsx`: remove the direct `@vercel/analytics/next` import and replace `<Analytics />` with `<ConsentedAnalytics />`. Add a one-line comment saying client trackers mount only through this wrapper.
- `lib/analytics.ts`: call `vercelTrack(event, props, { headers: SERVER_EVENT_HEADERS })`, where the constant contains `cookie: ""`, `"x-forwarded-for": ""` and a constant `user-agent` (decision 4). Add a comment explaining why, with a pointer to #63. Keep the `NODE_ENV === "test"` early return.

**Test:** `tests/unit/components/ConsentedAnalytics.test.tsx` (jsdom; `vi.mock("@vercel/analytics/next")` with a stub that records its props and renders a `data-testid` marker):
- No stored preference → the marker is absent.
- Stored `analytics:false` → absent.
- Stored `analytics:true` → present.
- `setAnalyticsConsent(true)` after mount → appears without a reload.
- After a revoke, the captured `beforeSend({url})` returns `null`. While granted, it returns the event unchanged.

**Test:** extend `tests/unit/analytics.test.ts`. With `NODE_ENV=production`, `vercelTrack` gets a third argument whose `headers` contain `cookie: ""` and `x-forwarded-for: ""`, and no `request`. Update the existing `toHaveBeenCalledWith` expectation.

**Test:** add a static guard in `tests/unit/cookie-consent/no-direct-analytics.test.ts`. It globs `app/**/*.tsx` + `components/**/*.tsx` and asserts that `@vercel/analytics/next` / `@vercel/analytics/react` is imported **only** by `components/cookie-consent/ConsentedAnalytics.tsx`. This stops a future re-introduction of the unconditional mount.

### Step 3 — Non-modal bottom banner (Hebrew RTL)

**Files:**
- `lib/i18n/he.ts`: new top-level `cookieConsent` block with `title`, `body` (essential cookies keep the app working, so chat and the anonymous session always work; optional anonymous usage statistics through Vercel Analytics), `acceptAnalytics`, `essentialOnly`, `privacyLink`, `settingsLink`, `regionLabel`, and the `settings.*` strings for step 4. Mark it `// draft — pending legal review (#63)`, the same convention as `privacy.version`.
- New `components/cookie-consent/CookieBanner.tsx` (`"use client"`):
  - Renders only when the status is `"unset"`, so nothing is rendered for `unknown` (SSR and first paint), `granted` or `denied`.
  - `<section role="region" aria-labelledby="cookie-banner-title" dir="rtl" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 …">`, with an `h2` title, body text, and links to `/privacy` and `/settings` (`next/link`, underlined, `min-h-11 inline-flex items-center` tap target).
  - Two `<Button>`s with equal weight (decision 8), each `min-h-11 min-w-11`, calling `setAnalyticsConsent(true|false)`.
  - **No autofocus** and no focus trap, so it doesn't steal focus from the chat input. It sits last in the DOM, so keyboard users reach it after the page content. Visible focus rings come from the shadcn `Button`.
  - Height publishing per decision 7: a `ResizeObserver` (guarded with `typeof ResizeObserver !== "undefined"`) sets `--cookie-banner-h`, and unmount/hide resets it to `0px`.
  - Imports nothing from `components/chat/ConsentDialog` or `/api/consent`.
- `app/layout.tsx`: mount `<CookieBanner />` after `{children}`.
- `app/globals.css`: `body { padding-bottom: var(--cookie-banner-h, 0px); }`.
- `components/chat/ChatShell.tsx:51` and `components/interview/InterviewChat.tsx:155`: change `h-dvh` → `h-[calc(100dvh-var(--cookie-banner-h,0px))]`. `components/cv/CvReview.tsx:288`: `bottom-0` → `bottom-[var(--cookie-banner-h,0px)]`. Class-only changes.
- `tests/unit/privacy/no-hebrew-outside-i18n.test.ts`: add `components/cookie-consent/**/*.{ts,tsx}` to the glob, and add `CookieBanner.tsx` to the "matches the files it is meant to guard" list.

**Test:** `tests/unit/components/CookieBanner.test.tsx` (jsdom):
- With no preference, the banner region is shown via `getByRole("region", { name: he.cookieConsent.regionLabel })`, with both buttons, and links with `href="/privacy"` and `href="/settings"`.
- **Non-blocking essential-only path:** render the banner next to a sibling `<input aria-label="composer">`. Clicking `essentialOnly` hides the banner and persists `analytics:false`. The sibling input is still enabled and focusable, and nothing in the tree has `aria-modal` or `inert`. Also assert that while the banner is visible the sibling stays interactive (`fireEvent.change` works, `document.activeElement` isn't moved to the banner on mount).
- Accept → hides, persists `analytics:true`.
- A stored valid preference → not rendered. A stored older-version preference → rendered (re-show on version bump).
- `--cookie-banner-h` resets to `0px` after a choice.
- Both buttons carry the `min-h-11` class (a guard for the 44px target).

### Step 4 — Settings toggle, privacy copy, docs

**Files:**
- New `components/settings/CookiePreferences.tsx` (`"use client"`), a `Card` with a heading, a description and one `<button role="switch" aria-checked={granted} aria-labelledby aria-describedby className="min-h-11 …">` that calls `setAnalyticsConsent(!granted)`. Status text: `he.cookieConsent.settings.on/off/unset`. During `unknown` (SSR), render the switch disabled with `aria-busy`, so there's no hydration mismatch. It also lists essential cookies as always-on, not toggleable.
- `app/(app)/settings/page.tsx`: render `<CookiePreferences />` **outside** the `view.kind` switch, after the data-rights block. Cookie choice doesn't depend on identity, data-rights enablement or sign-in, so it shows in all 5 states.
- `lib/i18n/he.ts` `privacy.sections`: new section "עוגיות ואחסון בדפדפן" ("Cookies and browser storage"). It covers:
  - Essential: the anonymous session (`co_anon`), sign-in (Supabase), and the cookie-choice record in localStorage.
  - Optional: Vercel Analytics, loaded only after consent.
  - Server-side aggregate counters that carry no browser identifiers.
  - Changing the choice in settings.
  Bump `privacy.version` to `0.3`. **Don't** assert "cookieless" for Vercel in the copy unless that's confirmed against Vercel's current docs during implementation.
- `CLAUDE.md`: add a short "Cookie consent (#63)" section with these rules:
  - Client trackers mount only via `ConsentedAnalytics`.
  - Bump `COOKIE_CONSENT_VERSION` when adding a non-essential category.
  - Server `track()` must not forward request headers.
  - `ConsentDialog` (DB consent) is separate.

**Test:** `tests/unit/components/CookiePreferences.test.tsx` (jsdom): reflects the stored state (`aria-checked`). A click toggles and persists. A toggle from settings hides a mounted `CookieBanner` in the same tree, because of the shared store event. Keyboard `Enter`/`Space` work through the native `<button>`.

**Test:** extend `tests/unit/settings/page.test.tsx`. `CookiePreferences` renders in the `disabled` and `sessionExpired` views as well as `panel`. Mock it as a marker, following the file's existing mocking pattern.

**Manual:** `node scripts/verify-all-surfaces.mjs` with a fresh context. There should be zero critical/serious axe violations with the banner visible on all 15 surfaces, and at 375px the `/chat` and `/interview` composers and the `/cv` save bar must be fully visible above the banner (check the screenshots).

## 3. Acceptance-criteria mapping

| Criterion | Where |
|---|---|
| Hebrew RTL banner, copy in `he.ts` | Step 3, plus the extended no-Hebrew guard |
| Essential vs analytics distinction | Banner body (step 3), settings card (step 4), privacy section (step 4) |
| Essential-only never blocks core use | Default-deny, non-modal, composer offset (decisions 3, 6, 7); test in step 3 |
| Persist; re-show only on version change / cleared | Step 1 helper + tests; re-show test in step 3 |
| Links to `/privacy` and `/settings` | Step 3 |
| Client Analytics not loaded before consent; server decision documented | Step 2; decision 4 |
| No DB migration; processing/disclaimer flow unchanged | No `supabase/` or `lib/consent.ts` / `ConsentDialog` edits |
| Tests for persist, gating, essential-only | Steps 1–4 |
| A11y: focusable, labelled, 44px | `role="region"` + `aria-labelledby`, `role="switch"` + `aria-checked`, `min-h-11`; axe run |

## 4. Risks and open questions

- **Legal sufficiency** (out of scope): flag for Moti/expert. Is a banner required before closed beta, and is "server aggregate counters without identifiers" acceptable without consent under the Israeli Privacy Protection Law (Amendment 13)? If the answer is no, the fallback is small: gate `track()` on a mirrored `co_cookie_consent` cookie, which needs a version-bump plus cookie write in `store.ts`.
- **Vercel server events without UA/IP** may be filtered or lose device breakdowns. Verify on preview (decision 4).
- **Pages with their own bottom-fixed UI** added later must use `--cookie-banner-h`. The CLAUDE.md note covers this.
- **Sentry is server/edge only** (Phase 6c), so it's not a client tracker and isn't affected. If the browser SDK lands later (6c.5), it must go through the same gate or be justified as essential.
