#!/usr/bin/env bash
#
# A throwaway PostgreSQL for verifying migrations and running the SQL suites.
#
# Inspecting policy SQL tells you what someone intended. Running a request as a
# signed-in user tells you what the database will actually do, and that is the
# only thing worth trusting for a security model — so the migrations get applied
# from zero to a real server before any of it is called done.
#
#   scripts/local-db.sh up       # start a cluster on /tmp:5439
#   scripts/local-db.sh reset    # recreate the database and apply everything
#   scripts/local-db.sh test     # run every SQL suite
#   scripts/local-db.sh psql     # open a shell
#
set -euo pipefail

PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}
PGDATA=${PGDATA:-/var/lib/postgresql/mwdata}
PGHOST=${PGHOST:-/tmp}
PGPORT=${PGPORT:-5439}
PGUSER=${PGUSER:-postgres}
DB=${DB:-mw}

export PATH="$PGBIN:$PATH"

# PostgreSQL refuses to run as root, and this container is root. Server-side
# commands are dropped to the `postgres` account; client commands are not,
# because trust auth lets any local user connect as `postgres`.
as_postgres() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -s /bin/bash -c "PATH=$PGBIN:\$PATH $*"
  else
    bash -c "$*"
  fi
}

# Two migrations need Supabase Storage, pg_cron and pg_net, none of which exist
# on a bare server. They are skipped rather than stubbed: a stub that diverges
# is worse than a gap you can see.
SKIP='storage_and_rpc|scheduling_and_usage'

up() {
  if pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
    echo "already running on $PGHOST:$PGPORT"
    return
  fi
  if [ ! -d "$PGDATA" ]; then
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA" 2>/dev/null || true
    as_postgres "initdb -D $PGDATA -U $PGUSER --auth=trust" >/dev/null
  fi
  touch /tmp/pg.log && chmod 666 /tmp/pg.log
  as_postgres "pg_ctl -D $PGDATA -o '-k $PGHOST -p $PGPORT -c listen_addresses=\"\"' -l /tmp/pg.log start" >/dev/null
  sleep 2
  pg_isready -h "$PGHOST" -p "$PGPORT"
}

run() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$@"; }

reset() {
  up
  run -q -c "drop database if exists $DB;" -c "create database $DB;"
  run -d "$DB" -q -c "create extension pgcrypto; create extension citext;" \
                  -f supabase/tests/local_shim.sql > /dev/null

  for f in supabase/migrations/*.sql; do
    if echo "$f" | grep -qE "$SKIP"; then
      printf '  %-46s skipped (needs storage/cron/net)\n' "$(basename "$f")"
      continue
    fi
    # `grep -v` exits 1 when a migration is quiet, which under `pipefail` would
    # abort the run on success. The `|| true` is load-bearing.
    out=$(run -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 \
            | grep -v 'NOTICE\|low recall\|Drop the index' | head -4 || true)
    printf '  %-46s %s\n' "$(basename "$f")" "${out:-ok}"
  done

  run -d "$DB" -q -f supabase/seed.sql
  # The profile trigger needs a user to hang the demo data off.
  run -d "$DB" -q -c "insert into auth.users (id, email) values (gen_random_uuid(), 'seed@local.test');"
  run -d "$DB" -q -f supabase/seed_demo_warranty.sql
  run -d "$DB" -q -f supabase/seed_demo_service.sql
  run -d "$DB" -q -f supabase/pilot/israel_pilot.sql > /dev/null
  echo "  seeded"
}

test_suites() {
  up
  local failed=0
  for f in supabase/tests/*_test.sql; do
    out=$(run -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)
    n=$(echo "$out" | grep -c 'NOTICE:  ok' || true)
    if echo "$out" | grep -qE 'FAIL|ERROR'; then
      printf '  %-40s FAILED\n' "$(basename "$f")"
      echo "$out" | grep -E 'FAIL|ERROR' | head -3 | sed 's/^/      /'
      failed=1
    else
      printf '  %-40s %s assertions passed\n' "$(basename "$f")" "$n"
    fi
  done
  return $failed
}

case "${1:-reset}" in
  up)    up ;;
  reset) reset ;;
  test)  test_suites ;;
  psql)  shift; run -d "$DB" "$@" ;;
  *)     echo "usage: $0 {up|reset|test|psql}" >&2; exit 2 ;;
esac
