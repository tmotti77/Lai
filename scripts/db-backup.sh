#!/usr/bin/env bash
# Weekly encrypted backup of the career-os Supabase DB. See docs/runbooks/db-backup.md.
# Usage: SUPABASE_DB_URL=... BACKUP_PASSPHRASE=... scripts/db-backup.sh [output_dir]
set -euo pipefail
umask 077

die() { echo "db-backup: $*" >&2; exit 1; }

[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL is not set (use the Supabase session pooler connection string)"
[ -n "${BACKUP_PASSPHRASE:-}" ] || die "BACKUP_PASSPHRASE is not set"
for bin in pg_dump pg_restore gpg; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found on PATH"
done

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TS="$(date -u +%Y%m%dT%H%M%SZ)"
PLAIN="$WORK/careeros-db-$TS.dump"
OUT="$OUT_DIR/careeros-db-$TS.dump.gpg"

echo "db-backup: dumping (public, auth, storage)..." >&2
# Keep ACLs: the REVOKE EXECUTE on SECURITY DEFINER RPCs must survive a restore.
pg_dump --format=custom --no-owner \
  --schema=public --schema=auth --schema=storage \
  --file="$PLAIN" --dbname="$SUPABASE_DB_URL"

# Sanity check: archive must be readable before we encrypt it.
pg_restore --list "$PLAIN" >/dev/null || die "dump archive failed pg_restore --list sanity check"

echo "db-backup: encrypting (AES256)..." >&2
gpg --batch --yes --symmetric --cipher-algo AES256 --no-symkey-cache \
  --pinentry-mode loopback --passphrase-fd 3 \
  --output "$OUT" "$PLAIN" 3<<<"$BACKUP_PASSPHRASE"

echo "$OUT"
