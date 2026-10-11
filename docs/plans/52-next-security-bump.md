# Plan: #52 — Bump `next` 16.2.6 → 16.3.8 (security)

## Problem

`next@16.2.6` falls in the `npm audit` range `9.3.4-canary.0 – 16.3.7`, which has **critical** advisories. The ones that matter for CareerOS are:

- GHSA-6gpp-xcg3-4w24: Middleware/Proxy bypass in App Router apps using Turbopack. We use Turbopack, and `proxy.ts` is what bootstraps the `co_anon` cookie and refreshes the Supabase session.
- GHSA-m99w-x7hq-7vfj / GHSA-4c39-4ccg-62r3 / GHSA-89xv-2m56-2m9x: Server Action DoS / unbounded payload / SSRF.
- GHSA-68g3-v927-f742 / GHSA-4633-3j49-mh5q: Cache confusion of response bodies for requests with bodies. All of our mutation routes are POST route handlers.
- GHSA-955p-x3mx-jcvp: Unauthenticated disclosure of internal Server Function endpoints.
- GHSA-cjq9-62q9-8jv4, GHSA-q8wf-6r8g-63ch, GHSA-2xp9-vwfh-vxw4: Image Optimization SSRF/DoS/RCE.
- GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p, GHSA-f87g-xv8r-7p7x, GHSA-39w2-rjm5-chcv: fixed in 16.3.8 (cache poisoning / info disclosure).

`eslint-config-next` is pinned to the same version and pulls `@next/eslint-plugin-next` → `fast-glob` (flagged high), so it moves in lockstep.

## Target version

From `npm view next versions` on 2026-10-11:

- The latest 16.3.x is **16.3.8**, released 2026-09-30, a security-only patch with 6 advisories. `latest` is 16.4.0, but #52 scopes this change to 16.3.x, so 16.4 is out of scope.
- `eslint-config-next@16.3.8` exists.

`react` / `react-dom` stay at 19.2.4 unless `next@16.3.8`'s peer range requires otherwise (checked during install).

## 16.3 release notes: what affects us

Sources: https://nextjs.org/blog/next-16-3, https://nextjs.org/docs/app/guides/upgrading/version-16, and the v16.3.8 GitHub release.

16.3 is a minor with **no documented breaking changes to proxy.ts, Server Actions or caching APIs**. These changed defaults and new behaviors apply to us:

| Change | Impact on CareerOS | Action |
|---|---|---|
| `proxy.ts` (nodejs runtime, `export function proxy`). Unchanged since 16.0. | Our `proxy.ts` already uses the 16.x convention. | Add a matcher regression test (below). |
| Turbopack **filesystem cache for `next build` is on by default** (`turbopackFileSystemCacheForBuild`). | Build artifacts are cached under `.next/` (already gitignored). CI starts from a fresh checkout, so builds there are cold. | None. Note it in the risks section. |
| App Router SSR moved from web streams to **native Node streams**. | Our streaming responses (chat SSE, CV extract, interview) are **route handlers** that return `Response`/AI SDK streams. They are not the RSC render path. | Covered by build plus the existing engine/route tests. Manual smoke of `/chat` streaming recommended before deploy. |
| Turbopack file tracing is conservative for dynamic `process.cwd()` joins (third-party report). | `lib/pdf/fonts.ts` uses a literal path (`public/fonts/Heebo-VF.ttf`). Catalog JSON is imported statically. | Check build output for tracing warnings. |
| `next dev` maintains a version-matched `AGENTS.md` block when it detects a coding agent. | AGENTS.md must not be edited without approval. | Do not run `next dev` in this change. If a block appears, do not commit it. |
| Prefetch inlining and immutable static assets | Transparent. | None. |
| Edge runtime deprecation pressure (third-party report). | Every route is `runtime = "nodejs"`. `sentry.edge.config.ts` is used only by Sentry. | None. |
| No opt-in flags (`cacheComponents`, `partialPrefetching`, `useOffline`, Rust React Compiler) | Not adopted, so behavior is unchanged. | None. |

We have **no** Server Actions (`"use server"`), no `revalidateTag`, no `next/image` remote patterns, and no `unstable_` Next APIs, which keeps the exposure small.

## Solution

1. Run `npm install next@16.3.8 eslint-config-next@16.3.8 --save-exact` to keep the exact-pin convention. Commit `package.json` and `package-lock.json`.
2. Fix any lint, type or build breakage the bump introduces. None is expected.
3. Do not change `engines`, `scripts`, `next.config.ts` or `proxy.ts` unless something breaks.

## Tests (written first)

`tests/unit/next-version-guard.test.ts`:
- The installed `next` (from `node_modules/next/package.json`) is ≥ 16.3.8, the first version outside the audited vulnerable range. This is red on 16.2.6.
- `package.json` pins `next` and `eslint-config-next` to the **same exact** version, so they can't drift apart in a future partial bump.

`tests/unit/proxy-matcher.test.ts` uses `unstable_doesMiddlewareMatch` from `next/experimental/testing/server` against `proxy.ts`'s exported `config`:
- The matcher covers app pages (`/`, `/chat`, `/recommendations`, `/auth/callback`) and API routes (`/api/chat`, `/api/consent`). The proxy has to run there to bootstrap `co_anon` and refresh the Supabase session.
- The matcher skips `/_next/static/*`, `/_next/image`, `/favicon.ico` and image assets (`.svg/.png/...`).
- `proxy.ts` exports a function named `proxy`, which is the 16.x convention.

This pins proxy behavior across the bump, which is the surface named in the critical bypass advisory.

## Verification

- `npm audit`: there are no remaining `next` advisories. Record any remaining unrelated advisories, which are out of scope.
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. The build uses dummy env values and never real secrets.
- Baseline on 16.2.6: tsc clean, lint 0 errors / 3 pre-existing warnings, tests 298 passed / 16 skipped.

## Risks and edge cases

- **Node version.** `engines` requires Node ^24. The local agent sandbox runs Node 20.19, which is still ≥ Next's 20.9 minimum, so results should transfer. CI uses Node 24.
- **Transitive lockfile churn.** `next` brings a new `@next/swc-*`, `sharp` and `postcss`. Review the lockfile diff for unexpected major bumps.
- **Peer deps.** `@sentry/nextjs@10.53` peer range must accept next 16.3. Watch for ERESOLVE.
- **Build cache.** The new on-by-default build FS cache could mask a stale artifact locally. Mitigate by running the verification build from a clean `.next/`.
- **Runtime-only regressions** (the streaming path change) are not covered by the unit tests. Before production deploy, run `scripts/verify-all-surfaces.mjs` plus a manual chat/CV stream smoke on a preview deployment.

## Rollback

Revert the bump commit. `package.json` and `package-lock.json` return to 16.2.6, and there are no code, schema or config changes to undo. If you need to roll back on Vercel, redeploy the previous deployment. No DB or migration impact.
