# Launch Rollback Runbook

Quick operational reference. Full design rationale lives in `docs/superpowers/specs/2026-05-20-career-os-07a-launch-readiness-design.md` §8.

## When to roll back

- Issue is user-facing AND broad AND security-sensitive OR revenue-blocking OR the forward fix is uncertain → **roll back**
- Issue is small AND well-understood AND tested AND safer than restoring old code/data → **roll forward**
- Database state is unclear → **pause and escalate**

## App-level rollback (primary path)

1. Identify currently active production deployment SHA and previous known-good SHA.
2. In Vercel dashboard → Deployments → previous known-good deployment → "Promote to Production".
3. Verify production routes:
   - `GET /` → 200
   - `GET /privacy` → 200
   - `GET /terms` → 200
   - `POST /api/chat` (with consent) → 200 stream
   - `GET /api/admin/feedback/export` → 401 without auth
4. Re-run `node scripts/smoke-production.mjs ...` against the deployed URL.
5. Record incident: rollback SHA, reason, timestamp, verifier.

This action is instant and idempotent.

## Database rollback (never automatic)

Requires explicit human decision. Before any production schema change, confirm a pre-deploy backup exists.

Options:

- **PITR restore** if point-in-time recovery enabled (not enabled in 7a)
- **Manual SQL repair** — reviewed, transaction-wrapped
- **Forward migration** when safer than reverting

**Never apply destructive SQL during an incident without a second reviewer.**

## Scenario quick-ref

| Scenario | First action |
|---|---|
| Bad migration applied | Stop promote if possible. If live: decide if app rollback alone suffices. Schema-incompatible? Forward-fix migration or manual SQL. |
| Bad env var set | Correct env var → redeploy → smoke. Never print secrets. |
| Bad code shipped | Vercel promote previous known-good → smoke. |
| Production data corruption from buggy mutation | Disable mutation path (kill switch / feature flag) → preserve evidence → estimate blast radius → PITR / manual SQL / forward repair. App rollback alone won't fix corrupted rows. |

## Testing this runbook

Before public launch: dry-run by promoting a previous SHA and back. Confirm smoke passes after each promotion. Record screenshots.

## Communications

Notify release owner, engineering lead, product owner, support/admin watchers. For security or data-integrity incidents add data owner and incident lead. Update format: impact, action taken, current SHA, DB decision, next verification step.
