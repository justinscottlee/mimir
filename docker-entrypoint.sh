#!/bin/sh
# Applies any pending database migrations, then starts the Next.js dev server.
# Compose waits for Postgres to be healthy before this runs (depends_on), so the
# database is reachable by the time we migrate.
set -e

# Better Auth needs a stable secret to sign sessions. If the operator hasn't set
# one (or left the CHANGE_ME placeholder), generate a strong random secret and
# persist it to .auth-secret so it stays stable across restarts (a new secret
# each boot would invalidate everyone's sessions). Setting BETTER_AUTH_SECRET in
# .env always takes precedence over this fallback.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

if [ -z "$BETTER_AUTH_SECRET" ] || [ "$BETTER_AUTH_SECRET" = "CHANGE_ME" ]; then
  SECRET_FILE="/app/.auth-secret"
  if [ -f "$SECRET_FILE" ]; then
    BETTER_AUTH_SECRET="$(cat "$SECRET_FILE")"
    echo "[mimir] using the persisted auth secret (.auth-secret)."
  else
    BETTER_AUTH_SECRET="$(gen_secret)"
    if printf '%s' "$BETTER_AUTH_SECRET" >"$SECRET_FILE" 2>/dev/null; then
      echo "[mimir] no BETTER_AUTH_SECRET set — generated one and saved it to .auth-secret (set BETTER_AUTH_SECRET in .env to override)."
    else
      echo "[mimir] no BETTER_AUTH_SECRET set — generated an ephemeral one (couldn't persist it, so sessions reset on restart; set BETTER_AUTH_SECRET in .env to fix)."
    fi
  fi
  export BETTER_AUTH_SECRET
fi

echo "[mimir] applying database migrations…"
if npx drizzle-kit migrate; then
  echo "[mimir] migrations applied."
else
  echo "[mimir] WARNING: migration step failed — the app may misbehave until the schema is current. Continuing to start the server."
fi

echo "[mimir] starting Next.js on 0.0.0.0:3000"
exec npx next dev -H 0.0.0.0 -p 3000
