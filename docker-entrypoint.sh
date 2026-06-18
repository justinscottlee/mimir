#!/bin/sh
# Applies any pending database migrations, then starts the Next.js dev server.
# Compose waits for Postgres to be healthy before this runs (depends_on), so the
# database is reachable by the time we migrate.
set -e

echo "[mimir] applying database migrations…"
if npx drizzle-kit migrate; then
  echo "[mimir] migrations applied."
else
  echo "[mimir] WARNING: migration step failed — the app may misbehave until the schema is current. Continuing to start the server."
fi

echo "[mimir] starting Next.js on 0.0.0.0:3000"
exec npx next dev -H 0.0.0.0 -p 3000
