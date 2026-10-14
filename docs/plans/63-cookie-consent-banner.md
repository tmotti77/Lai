# Plan — #63: cookie / analytics consent banner

> Issue: [#63](https://github.com/tmotti77/Lai/issues/63). Roadmap Phase 7 (cookie consent banner) + launch-expert packet.
> Branch: `feat/cookie-consent`
> Status: plan only. No code written yet.

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
| `components/chat/ChatShell.tsx:51`, `components/interview/InterviewChat.tsx:155` | `h-dvh` column with the composer pinned to the bottom | Shrink by the banner height so the composer is never covered (step 3) |
| `components/cv/CvReview.tsx:288` | `fixed bottom-0` save bar | Offset by the banner height (step 3) |
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
node scripts/verify-all-surfaces.mjs           # manual: axe + 375/768/1280 overlap check (needs `npm run dev`)
```

Test conventions: Vitest defaults to `environment: "node"`. Component tests opt in with a `/** @vitest-environment jsdom */` docblock. `@testing-library/react` + `jest-dom` are available, `user-event` is **not**, so use `fireEvent`. Don't add dependencies.

## 1. Decisions

1. **Storage is localStorage only, with no new cookie.** Key `careeros.cookieConsent`, value `{ v: number, analytics: boolean, at: ISO string }`. The server never needs the choice, because after decision 4 server events carry no browser identifiers. A cookie would add a request-time read to every route for no benefit. If storage is unavailable (private mode, blocked storage), the choice lives in memory for the tab, and the banner re-shows on the next visit. That's acceptable and conservative.
2. **Versioning:** `COOKIE_CONSENT_VERSION = 1`. A stored `v` that differs, malformed JSON or a wrong shape is all treated as "no choice", so the banner re-shows. Bump the version whenever a new non-essential category or vendor is added.
3. **Default is deny.** Until the user picks "accept analytics", `<Analytics />` is not mounted, so the Vercel script is never injected. If the user ignores the banner, the app works fully and analytics stays off.
4. **Server `track()` keeps running, but without browser identifiers.** The events are already allowlisted and free of PII at compile time (`EventPropsMap`). The real leak is that `@vercel/analytics/server` forwards the request's `cookie` (which includes `co_anon` and the Supabase `sb-*` auth tokens), the IP and the UA (see the context map). Pass an explicit `headers` option to `vercelTrack` so none of these go out. Server events then become aggregate counters with no link to a browser, which matches what the privacy page already promises ("סטטיסטיקות שימוש מצרפיות, ללא מזהים אישיים"). That's why they aren't gated on the browser choice. **Verify on a Vercel preview** that the events still show up in the dashboard. If Vercel drops events without a UA, forward a constant UA string, and never the real one.
5. **Revoke takes effect without a reload.** Once the Vercel script has been injected, unmounting `<Analytics>` doesn't remove it. So the wrapper also passes `beforeSend`, which re-reads the live preference on every event and returns `null` when analytics isn't granted. On the next full load, the script isn't injected at all.
6. **The banner is non-modal.** It's a `<section role="region" aria-labelledby>` fixed to the bottom, with no backdrop, no focus trap and no `aria-modal`, at `z-40`, which is below the Radix dialog overlay (`z-50`). So `ConsentDialog` on `/chat` still sits on top and is completed first. Radix marks the banner inert while the dialog is open, which is correct.
7. **The banner never covers the composer.** While it's visible, the banner publishes its height as `--cookie-banner-h` on `<html>` through a `ResizeObserver`, and resets the variable to `0px` when hidden. The three bottom-anchored surfaces consume the variable (step 3). Other pages scroll normally, and `body` gets `padding-bottom: var(--cookie-banner-h, 0px)` in `globals.css`.
8. **Equal-weight buttons, no dark pattern.** "אישור סטטיסטיקות" ("Accept analytics") and "רק חיוניות" ("Essential only") get the same size and variant (`outline` + default, side by side, each `min-h-11` = 44px). There's no close X, so dismissing without a choice isn't a third, ambiguous state. Ignoring the banner equals deny, per decision 3.

## 2. Steps

### Step 1 — Pure preference helper + store

**Files (new):**
- `lib/cookie-consent/preference.ts`, client-safe (no `server-only`, no React):
  - `COOKIE_CONSENT_VERSION`, `COOKIE_CONSENT_STORAGE_KEY`, and the `CookiePreference` type.
  - `readPreference(storage: Pick<Storage,"getItem"> | null): CookiePreference | null`. Returns null for missing / malformed / wrong-version / throwing storage.
  - `writePreference(storage, analytics: boolean, now: Date): CookiePreference`. Never throws; swallows quota and security errors and still returns the value.
  - `clearPreference(storage)`.
- `lib/cookie-consent/store.ts`: a tiny external store for `useSyncExternalStore`:
  - `getStatus(): "unset" | "granted" | "denied"`, a string snapshot so identity stays stable. It reads storage, with an in-memory override for when storage fails.
  - `getServerStatus(): "unknown"`. The SSR and hydration snapshot, so the server never renders the banner and there's no hydration mismatch.
  - `setAnalyticsConsent(granted)` writes the value, then dispatches `careeros:cookie-consent` on `window`.
  - `subscribe(cb)` listens to that event **and** `storage`, for cross-tab sync.
  - `hasAnalyticsConsent()`, the boolean used by `beforeSend`.
- `lib/cookie-consent/useCookieConsent.ts`: `useSyncExternalStore(subscribe, getStatus, getServerStatus)`.

**Test:** `tests/unit/cookie-consent/preference.test.ts` (node env, a fake `Map`-backed storage):
- A round-trip persists `analytics: true/false`.
- Version mismatch → null, so the banner re-shows. Malformed JSON → null. Wrong shape (`analytics: "yes"`) → null.
- `getItem`/`setItem` throwing → read returns null and write doesn't throw.
- `clearPreference` → null.

**Test:** `tests/unit/cookie-consent/store.test.ts` (jsdom): `setAnalyticsConsent` notifies subscribers. A `storage` event from another tab notifies. The in-memory fallback works when `localStorage.setItem` throws (stub it). `getServerStatus` is `"unknown"`.

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
