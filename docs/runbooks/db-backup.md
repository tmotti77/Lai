# Runbook: weekly DB backup (career-os)

The closed beta runs on the **free** Supabase project `career-os` (`wqswamtcppjmkwykukjp`), which has no backups or PITR. This runbook covers our own weekly encrypted `pg_dump`. Design: `docs/plans/db-weekly-backup.md`.

## What gets backed up
- Schemas `public`, `auth` (users, identities, password hashes, refresh tokens) and `storage` (**metadata rows only**).
- Custom-format `pg_dump` with `--no-owner`, encrypted with GPG symmetric AES256.
- **Privileges (GRANT/REVOKE) are preserved** in the dump and on restore. This keeps the REVOKE EXECUTE on SECURITY DEFINER RPCs from `20260517100000_revoke_rpc_execute.sql`; dropping ACLs would let `anon`/`authenticated` call them again.
- **Not included:** the files in Storage buckets, e.g. CVs in `cv-uploads`. See "Storage files" below.

## Secrets (never commit them)
Set them in GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | The **session pooler** connection string (Supabase → Connect → Session pooler, port 5432), with the DB password filled in. Don't use the direct host, because it's IPv6-only and Actions runners have no IPv6. Don't use the transaction pooler (6543), because it breaks `pg_dump`. |
| `BACKUP_PASSPHRASE` | A long random passphrase, e.g. `openssl rand -base64 32`. **Store it in the password manager.** If it's lost, every backup is unrecoverable. |

If either secret is missing, the workflow logs a warning and skips. It stays green.

## Schedule and storage
- `.github/workflows/db-backup.yml` runs **Sundays 02:00 UTC** and on demand (Actions → DB Backup → Run workflow).
- Each run uploads `careeros-db-<run id>` with one `careeros-db-<UTC timestamp>.dump.gpg` as a workflow artifact, kept **90 days**, or less if the repo/org retention setting is lower.
- Artifacts are only downloadable by repo collaborators, and they are encrypted. For longer-term retention, download one monthly and keep it in an offsite location (e.g. a private cloud drive).

## Run locally
Needs `pg_dump`/`pg_restore` with **major version ≥ the server's** (17), plus `gpg`.
```bash
export SUPABASE_DB_URL='<session pooler string>'   # from your shell/password manager, not a file in the repo
export BACKUP_PASSPHRASE='<passphrase>'
scripts/db-backup.sh ./backups      # ./backups is gitignored; prints the output path
```

## Restore / test-restore
Test-restore into a **throwaway local Postgres 17**, never into career-os:
```bash
docker run -d --name pg-restore-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
export TARGET_DB_URL='postgresql://postgres:test@localhost:55432/postgres'
export BACKUP_PASSPHRASE='<passphrase>'
scripts/db-restore.sh ./backups/careeros-db-<ts>.dump.gpg
psql "$TARGET_DB_URL" -c 'select count(*) from public.users;'
```
- On a plain Postgres, roles that Supabase creates (`authenticated`, `anon`, `service_role`) and extensions will produce some expected errors. Table data still restores.
- `RESTORE_CLEAN=1` adds `--clean --if-exists`.

### Post-restore check: SECURITY DEFINER privileges
After every restore (especially into a Supabase project), verify that `anon` and `authenticated` cannot execute any SECURITY DEFINER function in `public`. `has_function_privilege` also counts grants to `PUBLIC`. This must return **zero rows**:
```sql
select p.oid::regprocedure as function, r.rolname as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.rolname in ('anon', 'authenticated')
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege(r.oid, p.oid, 'EXECUTE');
```
If it returns rows, re-apply the revokes from `supabase/migrations/20260517100000_revoke_rpc_execute.sql` before exposing the database to clients.
- The script **refuses** any target that contains the career-os project ref, or that equals `SUPABASE_DB_URL`, unless `I_KNOW_THIS_IS_PROD=1`. Restoring into production is a disaster-recovery action and needs Moti's go-ahead. Prefer restoring only the affected tables (`pg_restore --list` / `--use-list`).

Do a test-restore after the first scheduled run, and then quarterly.

## Storage files
CV files in the `cv-uploads` bucket are not part of the dump. To back them up manually, download the bucket from the Supabase dashboard (Storage) or with the Supabase CLI, and keep the files with the matching dump.

## Limitations
- Weekly granularity: up to 7 days of data can be lost.
- The free tier auto-pauses after 7 idle days. A paused project makes the backup fail, which is visible as a red workflow run.
- This is a stopgap. Before public launch, move to Pro (daily backups / PITR) as planned.
