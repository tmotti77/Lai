# Critique: weekly DB backup (PR #56)

Plan: `docs/plans/db-weekly-backup.md`.

**No Codex plan critique was run before implementation.** This file records a *retrospective code review* of the implemented branch (`ops/weekly-db-backup`): a Codex code review plus the automated claude-review on PR #56, and how each finding was handled.

## Codex code review

| Sev | Finding | Resolution |
|---|---|---|
| P1 | `pg_dump` / `pg_restore` used `--no-privileges`, so the dump dropped all GRANT/REVOKE. A restore would give `PUBLIC` back EXECUTE on the SECURITY DEFINER RPCs (`merge_career_profile`, `increment_conversation_counters`), undoing `20260517100000_revoke_rpc_execute.sql`. | Fixed in `cbc3537` (red test `345a887`): both scripts keep ACLs; tests assert no `--no-privileges` / `--no-acl` / `-x`. Runbook adds a post-restore SQL check that `anon`/`authenticated` can't execute any `public` SECURITY DEFINER function. |

## claude-review (PR #56)

| # | Finding | Resolution |
|---|---|---|
| 1 | A missing secret made the scheduled job go green with only a `::warning::`, so backups could silently stop. | Fixed. The `Check secrets` step gets `EVENT_NAME` and exits 1 with `::error::` on `schedule`; `workflow_dispatch` keeps the soft skip. Tests extract and run the real step script for both events. |
| 2 | `pg_restore` exits non-zero on ignorable errors (e.g. plain Postgres without Supabase roles), so `set -e` aborted before `done` with no explanation. | Fixed. Exit status is captured; default stays strict and dies with `pg_restore exited with status N` plus a hint. `RESTORE_ALLOW_ERRORS=1` finishes with a warning. Both paths tested; documented in the runbook. |
| 3 | Tests didn't prove the passphrase reaches gpg via fd 3, nor cover `RESTORE_CLEAN=1`; `as unknown as NodeJS.ProcessEnv` double cast. | Fixed. The gpg stub writes what it read from fd 3 to a file, and tests assert `--passphrase-fd 3` and that the content equals the passphrase (backup and restore). Added a `RESTORE_CLEAN=1` → `--clean --if-exists` test (and its absence by default). The cast is gone: the env object sets `NODE_ENV`, which Next's `ProcessEnv` augmentation requires. |
| 4 | `actions/checkout` persisted the `GITHUB_TOKEN` in `.git/config`. | Fixed: `persist-credentials: false`; tested. |
| 5 | Runbook didn't state that the artifact's only protection is the passphrase (dump includes auth password hashes), or warn against passwords in the URL for local runs. | Fixed in `docs/runbooks/db-backup.md`: passphrase-strength note, and local runs use `PGPASSWORD` instead of an embedded password. |

## Process note

For future ops changes, run the Codex plan critique (WORKFLOW.md step 3) before implementation. The P1 above is the kind of issue a plan critique would likely have caught before code was written.
