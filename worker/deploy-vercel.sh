#!/usr/bin/env bash
# Deploy storybook-ai-worker to Vercel Hobby + Turso (libSQL). Never prints
# secret values. Design §10, portable (no Cloudflare).
#
# Required env:
#   LIBSQL_URL               libsql:// URL for the Turso database
#   LIBSQL_AUTH_TOKEN        Turso auth token
#   WORKER_SESSION_SECRET    HMAC key for session cookies + signed media URLs
#
# Optional env (skipped if unset):
#   OPENROUTER_API_KEY, FAL_KEY,
#   ENABLE_OPENROUTER, ENABLE_FAL, KILL_SWITCH, MOCK_PROVIDERS,
#   ALLOWED_ORIGIN, PUBLIC_API_BASE
set -euo pipefail
set +x

cd "$(dirname "$0")"

for name in LIBSQL_URL LIBSQL_AUTH_TOKEN WORKER_SESSION_SECRET; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 1
  fi
done

if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI is required (npm i -g vercel)" >&2
  exit 1
fi

echo "Applying libSQL migrations..."
LIBSQL_URL="$LIBSQL_URL" LIBSQL_AUTH_TOKEN="$LIBSQL_AUTH_TOKEN" npm run migrate --silent

# Push each present var/secret to the production environment. `vercel env add`
# reads the value from stdin so nothing is printed. Existing values are removed
# first to make the script idempotent across redeploys.
upsert_env() {
  local name="$1" value="$2"
  if [[ -z "$value" ]]; then
    echo "Skipping unset $name"
    return
  fi
  echo "Setting $name..."
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$name" production >/dev/null
}

upsert_env LIBSQL_URL             "$LIBSQL_URL"
upsert_env LIBSQL_AUTH_TOKEN      "$LIBSQL_AUTH_TOKEN"
upsert_env WORKER_SESSION_SECRET  "$WORKER_SESSION_SECRET"
upsert_env OPENROUTER_API_KEY     "${OPENROUTER_API_KEY:-}"
upsert_env FAL_KEY                "${FAL_KEY:-}"
upsert_env ENABLE_OPENROUTER      "${ENABLE_OPENROUTER:-}"
upsert_env ENABLE_FAL             "${ENABLE_FAL:-}"
upsert_env KILL_SWITCH            "${KILL_SWITCH:-}"
upsert_env MOCK_PROVIDERS         "${MOCK_PROVIDERS:-}"
upsert_env ALLOWED_ORIGIN         "${ALLOWED_ORIGIN:-}"
upsert_env PUBLIC_API_BASE        "${PUBLIC_API_BASE:-}"

echo "Deploying to production..."
vercel deploy --prod

echo "Deployed."
