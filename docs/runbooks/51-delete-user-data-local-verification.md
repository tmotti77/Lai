# #51 / #54 — `delete_user_data` migration: local Postgres verification

Run 2026-10-12 against a **local** PostgreSQL 17 on the agent box (no cloud project, no Supabase branch).
Migration under test: `supabase/migrations/20261011120000_user_data_rights.sql` (merged in #54, **not yet applied** to production).

## How
`scripts/db-verify/run.sh` (local only; set `PGUSER`/`PGPASSWORD` for your local server):
1. Fresh DB `careeros_test`; `shim.sql` stands in for Supabase-managed objects (roles `anon`/`authenticated`/`service_role`, `auth.users` + `auth.uid()`, `storage.buckets/objects/foldername`).
2. Applies **all** repo migrations in order — all 13 apply cleanly.
3. `test.sql` seeds every user-linked table (14: users, anonymous_sessions, consents, conversations, messages, career_profile incl. an orphan row with `conversation_id` null, assessments, recommendations, plans, plan_tasks, cv_uploads, interview_sessions, interview_messages, feedback ×2) for two users A and B, then runs the checks.

## Results
| Check | Result |
|---|---|
| All migrations apply on PG17 | PASS |
| Delete A as `service_role`: every A row in all 14 tables gone; report counts match seed | PASS |
| Isolation: B's rows byte-identical before/after | PASS |
| Rollback: failure injected at the last stage (trigger on `users` delete) → A fully intact | PASS (single transaction) |
| Grants: `anon` / `authenticated` / `PUBLIC` cannot execute (permission denied); `service_role` can | PASS |
| Idempotent: second call and unknown uuid return all-zero report, no error | PASS |
| `auth.users` row is **not** removed by the function | Expected — the app deletes it via the auth admin API last (`lib/privacy/delete.ts`) |
| Generated types vs hand-edited `lib/db/types.gen.ts` | Semantically identical (see below) |

## Types
`npm run db:types` uses `--linked` (cloud), so it was **not** run. Instead: `npx supabase gen types typescript --db-url postgresql://…@localhost/careeros_test --schema public`. After formatting, the only differences are generator-version noise (`ComputedFields: never`, `NonNullable<Json>`, the `__InternalSupabase` header, single-line formatting of `delete_user_data`). Columns, `last_export_at` and the `delete_user_data` RPC signature match. No types change needed.

## Caveats
- The Supabase `auth`/`storage` schemas are shims, not the real ones; the function touches neither.
- Locally the function owner is a superuser; on Supabase it is `postgres`. Both bypass RLS, so the behaviour is the same.
- Storage objects are removed by the app **before** this RPC. Keep `DATA_RIGHTS_ENABLED=false` until the migration is applied, then enable.
