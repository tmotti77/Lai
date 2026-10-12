#!/usr/bin/env bash
# LOCAL ONLY. Creates/drops local database careeros_orphans. Never point at the cloud project.
set -u
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../../supabase/migrations"; T=20260903000000_link_orphan_profiles.sql
export PGHOST=localhost PGUSER=${PGUSER:-postgres}
dropdb --if-exists careeros_orphans && createdb careeros_orphans
export PGDATABASE=careeros_orphans
psql -qX -v ON_ERROR_STOP=1 -f "$D/shim.sql"
for f in "$M"/*.sql; do [ "$(basename "$f")" = "$T" ] && continue; psql -qX -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE; done
psql -qX -f "$D/link-orphans-test.sql"
echo "== apply $T (1st)"; psql -qX -v ON_ERROR_STOP=1 -1 -f "$M/$T" && echo "APPLY 1: OK" || { echo "APPLY 1: FAILED"; exit 1; }
psql -X -f "$D/link-orphans-check.sql"
psql -qXAt -c "create table testkit.after1 as select * from public.career_profile"
echo "== apply $T (2nd, idempotency)"; psql -qX -v ON_ERROR_STOP=1 -1 -f "$M/$T" && echo "APPLY 2: OK"
psql -qXAt -c "select case when (select count(*) from (select * from testkit.after1 except select * from public.career_profile) x)=0 and (select count(*) from testkit.after1)=(select count(*) from public.career_profile) then 'PASS idempotent: 2nd run changed nothing' else 'FAIL idempotent' end"
