#!/usr/bin/env bash
# Restore an encrypted career-os backup into TARGET_DB_URL. See docs/runbooks/db-backup.md.
# Usage: TARGET_DB_URL=... BACKUP_PASSPHRASE=... scripts/db-restore.sh <file.dump.gpg>
# RESTORE_CLEAN=1 adds --clean --if-exists. Refuses the career-os prod project unless I_KNOW_THIS_IS_PROD=1.
set -euo pipefail
umask 077

die() { echo "db-restore: $*" >&2; exit 1; }
PROD_REF="wqswamtcppjmkwykukjp"

[ -n "${TARGET_DB_URL:-}" ] || die "TARGET_DB_URL is not set"
[ -n "${BACKUP_PASSPHRASE:-}" ] || die "BACKUP_PASSPHRASE is not set"
FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || die "usage: db-restore.sh <file.dump.gpg>"

# Accident guard (not a security boundary): runs before decrypting or connecting.
if [ "${I_KNOW_THIS_IS_PROD:-}" != "1" ]; then
  lower="$(printf '%s' "$TARGET_DB_URL" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *"$PROD_REF"*) die "Refusing to restore into the career-os production project. Set I_KNOW_THIS_IS_PROD=1 to override." ;;
  esac
  if [ -n "${SUPABASE_DB_URL:-}" ] && [ "$TARGET_DB_URL" = "$SUPABASE_DB_URL" ]; then
    die "Refusing: TARGET_DB_URL equals SUPABASE_DB_URL (the backup source)."
  fi
fi

for bin in pg_restore gpg; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found on PATH"
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PLAIN="$WORK/restore.dump"

gpg --batch --yes --decrypt --pinentry-mode loopback --passphrase-fd 3 \
  --output "$PLAIN" "$FILE" 3<<<"$BACKUP_PASSPHRASE"

# Restore ACLs too; without them PUBLIC regains EXECUTE on SECURITY DEFINER RPCs.
ARGS=(--no-owner --dbname="$TARGET_DB_URL")
[ "${RESTORE_CLEAN:-}" = "1" ] && ARGS+=(--clean --if-exists)
pg_restore "${ARGS[@]}" "$PLAIN"
echo "db-restore: done" >&2
