# Critique: 51-data-export-delete (PR #54, backend part 1)

Retrospective: the Codex plan critique ran on 2026-10-12, after the backend was implemented, together with a Codex code review and the claude-review GitHub check. Verdict before fixes: request changes (no P0).

| # | Sev | Finding | Source | Outcome |
|---|-----|---------|--------|---------|
| 1 | P1 | Proxy/middleware minted anonymous users on `/api/me*`, defeating the read-only identity resolver | Codex plan + review | Fixed (`fcda442`, `2d48194`), tested through `proxy()` |
| 2 | P1 | `getUser()` errors treated as "no session", so a signed-in caller could get `deleted: true` without the account being deleted | Codex review | Fixed (`e9131e2`, `0ff172c`, `ffa2ee7`, `a4239d7`): errors classified by code, 503 on auth outage, 401 on rejected session, no fallback to `co_anon` |
| 3 | P1 | Storage sweep swallowed failures; uploads racing a delete could orphan CV objects | Codex plan, claude-review | Fixed (`847c8f1`, `34f82f6`): sweep retries, `storage_cleanup: "incomplete"` + `complete: false` + Sentry; upload removes its object on failed insert and is refused while a deletion lock is held |
| 4 | P2 | Every signed-URL error treated as a missing CV | Codex plan | Fixed (`b2c562b`, `ba533e1`): only not-found is `available: false`, other errors fail the export (500) and release the cooldown slot |
| 5 | P2 | Auth-only accounts got 401 on export | Codex plan | Fixed (`72d8048`, `b5a41b6`) |
| 6 | P2 | Tests never execute the SQL function against Postgres | Codex plan, claude-review | **Open, gate before applying the migration**: run `delete_user_data` once on a local or branch Supabase (two users, isolation, rollback, EXECUTE grants), then `npm run db:types` with no diff |
| 7 | -  | No `Retry-After` on delete 409; repeated lock-release code | claude-review | Fixed (`5a48c4c`, `ecc3de8`) |
| 8 | P3 | Branch size (~2.8k lines incl. tests/mocks/plan) exceeds the plan estimate | Codex plan, claude-review | Accepted: source is ~700 lines, the rest is tests, mocks and the plan; UI stays in part 2 |
| 9 | -  | Deleting `consents` removes proof-of-consent | claude-review | Legal question for the Phase 7 lawyer review |
| 10 | - | Export built fully in memory | claude-review | Accepted for MVP; revisit with a cap or streaming if needed |

Codex re-review after the fixes (2026-10-12) found one new **P1, open**: when the middleware's own `getUser()` hits an expired token with a revoked refresh token, it clears the session cookies, so the route sees `AuthSessionMissingError` instead of a rejected session and can fall back to a live `co_anon` (DELETE reports success but only the anonymous footprint is removed). Fix: skip middleware auth refresh on `/api/me*` (or propagate the rejection) with a middleware+route test. Pending.

#51 is not complete until part 2 (settings UI, privacy page, a11y) ships.
