#!/usr/bin/env bash
# LOCAL ONLY. Creates/drops a local database careeros_test. Never point at the cloud project.
set -u
export PGHOST=localhost PGUSER=${PGUSER:-postgres}
dropdb --if-exists careeros_test && createdb careeros_test
export PGDATABASE=careeros_test
psql -qX -v ON_ERROR_STOP=1 -f "$(dirname "$0")"/shim.sql
for f in "$(dirname "$0")/../../supabase"/migrations/*.sql; do psql -qX -v ON_ERROR_STOP=1 -f $f 2>&1 | grep -v NOTICE; done
psql -X -f "$(dirname "$0")"/test.sql 2>&1
