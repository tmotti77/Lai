# Plan: Weekly encrypted DB backup for `career-os`

## Problem

The closed beta runs on the **free** Supabase project `career-os` (`wqswamtcppjmkwykukjp`). Free tier has no daily backups and no PITR. If someone drops a table, runs a bad migration or the project is lost, we lose every beta user's conversations, profiles, assessments, plans and auth accounts. We need an off-platform copy that is automatic, encrypted and restorable.

## Design

### `scripts/db-backup.sh [output_dir]`

- `set -euo pipefail`, `umask 077`. Secrets come only from env and are never echoed.
- Fails fast with a clear message if `SUPABASE_DB_URL` or `BACKUP_PASSPHRASE` is missing, or if `pg_dump`/`pg_restore`/`gpg` aren't on `PATH`. All of these checks run before any connection attempt.
- `pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth --schema=storage` writes to a plaintext file in a private `mktemp -d` dir. An `EXIT` trap deletes that dir, so the plaintext never outlives the script, even on failure.
- Sanity check: `pg_restore --list` on the plaintext archive. This catches truncated or corrupt dumps before we encrypt them.
- `gpg --batch --symmetric --cipher-algo AES256 --no-symkey-cache --pinentry-mode loopback --passphrase-fd 3`. The passphrase goes in on fd 3 through a here-string, so it never appears in argv or `ps`.
- Output: `<output_dir>/careeros-db-<UTC timestamp>.dump.gpg`. The default output dir is `./backups`, which is gitignored. The script prints the output path as the last line of stdout.

### `scripts/db-restore.sh <file.dump.gpg>`

- Requires `TARGET_DB_URL` and `BACKUP_PASSPHRASE`.
- **Prod guard** (runs before decrypt or connect): the script refuses if `TARGET_DB_URL` contains the `career-os` project ref (case-insensitive) unless `I_KNOW_THIS_IS_PROD=1`. The ref covers both the direct host (`db.<ref>.supabase.co`) and the pooler user (`postgres.<ref>`). It also refuses if `TARGET_DB_URL` equals `SUPABASE_DB_URL`. The guard is meant to stop accidents. It is not a security boundary.
- Decrypts to a private temp file, which the trap removes. Then runs `pg_restore --no-owner --no-privileges --dbname "$TARGET_DB_URL"`. `RESTORE_CLEAN=1` adds `--clean --if-exists`.

### `.github/workflows/db-backup.yml`

- `schedule: cron "0 2 * * 0"` (Sunday 02:00 UTC) + `workflow_dispatch`. `permissions: contents: read`. `concurrency` set to avoid overlapping runs.
- First step checks the secrets. If either is missing, it emits `::warning::`, the remaining steps are skipped, and the job stays green. Secrets are passed as env **per step**, never job-wide, so `actions/checkout` and `upload-artifact` don't receive them.
- Installs `postgresql-client-17` from the PGDG apt repo, prepends `/usr/lib/postgresql/17/bin` to `PATH` and asserts the client major is ≥ 17. The runner image ships an older client, and `pg_dump` refuses to dump a newer server.
- Runs the script into `$RUNNER_TEMP`, then `actions/upload-artifact@v4` with `retention-days: 90`, `if-no-files-found: error` and `compression-level: 0` (the ciphertext doesn't compress).

### Docs

`docs/runbooks/db-backup.md` covers running locally, the schedule, where dumps live, setting the secrets (session pooler string, because the direct host is IPv6-only and Actions runners have no IPv6, and the transaction pooler breaks `pg_dump`), restore and test-restore, retention and limitations.

## Tests (written first): `tests/unit/db-backup.test.ts`

The scripts run through `child_process.spawnSync("bash", ...)` with `PATH=<stub dir>:/usr/bin:/bin`. `pg_dump`, `pg_restore` and `gpg` are stub shell scripts that log their argv and write fake output, so no real database or encryption is involved. The `SUPABASE_DB_URL` in the tests points at `stub.invalid`.

1. Backup exits non-zero with a message naming `SUPABASE_DB_URL` when it's unset, and the same for `BACKUP_PASSPHRASE`. In both cases `pg_dump` is never invoked.
2. Restore exits non-zero naming `TARGET_DB_URL` / `BACKUP_PASSPHRASE` when unset.
3. Backup happy path (stubs): exit 0. Writes exactly one `careeros-db-*.dump.gpg`. `pg_dump` gets `--format=custom --no-owner --no-privileges` and the three schemas. `gpg` gets `--symmetric --cipher-algo AES256`. The passphrase is absent from every stub's argv and from stdout/stderr. No plaintext dump is left behind.
4. Restore guard: a URL with the prod ref (direct host and pooler-user forms, any case) exits non-zero with "Refusing", and `gpg` and `pg_restore` are never invoked. `I_KNOW_THIS_IS_PROD=1` lets it proceed. A non-prod URL proceeds. `TARGET_DB_URL == SUPABASE_DB_URL` is refused.
5. Static checks: the scripts and workflow contain no `postgres(ql)://` URLs, `password=`, JWTs (`eyJ…`), `sb_secret_`/`sbp_` tokens or inline `PGPASSWORD=`.
6. Workflow: it has a `schedule` cron and `workflow_dispatch`, top-level `permissions` is exactly `{contents: read}`, it installs `postgresql-client-17`, `retention-days: 90`, and the secrets reach the run step only via `secrets.*`.

There's no YAML parser in the dependency tree, so the workflow assertions use targeted regex on the file. No new dependency.

## Risks & edge cases

- **Client/server version skew.** Pinned to client 17, with an explicit assertion. If Supabase moves to PG 18, the workflow fails loudly. That's the correct failure mode, and the fix is to bump to 18.
- **PGDG apt source conflict** if a future runner image already configures PGDG under another filename with a different `Signed-By`. In that case `apt-get update` fails loudly and we adjust.
- **The dump includes `auth`**: emails, password hashes, refresh tokens. This is PII and credentials, hence AES256 encryption. If `BACKUP_PASSPHRASE` is lost, every backup is unrecoverable. The runbook says to keep it in the password manager.
- **Storage file objects are not included**, only `storage.*` metadata rows. CVs live in the `cv-uploads` bucket. The runbook documents the manual download.
- **Restoring `auth`/`storage` into another Supabase project** collides with the schemas that project already manages. The documented test-restore target is a throwaway local Postgres 17, and the runbook explains the expected errors.
- The connection string is in `pg_dump`'s argv. On an ephemeral single-tenant runner this is acceptable, and Actions masks secrets in logs.
- Artifact retention is capped by the repo/org setting. If that setting is < 90 days, GitHub silently applies the lower value.

## Rollback

The change is purely additive: no app code, no migrations, no DB writes. To roll back, disable the workflow in the Actions UI or revert the PR. Existing artifacts expire on their own.
