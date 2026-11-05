#!/usr/bin/env bash
# Deploy storybook-ai. Never prints secret values. Design §10.
set -euo pipefail
set +x

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required" >&2
  exit 1
fi

cd "$(dirname "$0")"

sed_replace() {
  # Portable-ish replace without printing the replacement value.
  local placeholder="$1" value="$2" file="wrangler.toml"
  PLACEHOLDER="$placeholder" REPLACEMENT="$value" perl -pi -e \
    's/\Q$ENV{PLACEHOLDER}\E/$ENV{REPLACEMENT}/g' "$file"
}

D1_ID=""
R2_NAME=""
QUEUE_NAME=""

if grep -q 'database_id = "local-d1-id"' wrangler.toml || grep -q '<D1_ID>' wrangler.toml; then
  echo "Creating D1 database storybook-ai..."
  OUT="$(wrangler d1 create storybook-ai)"
  D1_ID="$(printf '%s' "$OUT" | sed -n 's/.*database_id = "\([^"]*\)".*/\1/p')"
  [[ -n "$D1_ID" ]] || { echo "Could not parse D1 database id" >&2; exit 1; }
  sed_replace 'local-d1-id' "$D1_ID"
  sed_replace '<D1_ID>' "$D1_ID"
fi

if grep -q 'bucket_name = "storybook-media"' wrangler.toml || grep -q '<R2_BUCKET>' wrangler.toml; then
  R2_NAME="storybook-media"
  echo "Creating R2 bucket $R2_NAME..."
  wrangler r2 bucket create "$R2_NAME" || true
  sed_replace '<R2_BUCKET>' "$R2_NAME"
fi

if grep -q 'queue = "storybook-jobs"' wrangler.toml || grep -q '<QUEUE_NAME>' wrangler.toml; then
  QUEUE_NAME="storybook-jobs"
  echo "Creating queue $QUEUE_NAME..."
  wrangler queues create "$QUEUE_NAME" || true
  sed_replace '<QUEUE_NAME>' "$QUEUE_NAME"
fi

echo "Applying D1 migrations..."
wrangler d1 migrations apply storybook-ai --remote

for name in WORKER_SESSION_SECRET OPENROUTER_API_KEY FAL_KEY; do
  value="${!name:-}"
  if [[ -n "$value" ]]; then
    echo "Setting secret $name..."
    printf '%s' "$value" | wrangler secret put "$name"
  else
    echo "Skipping unset secret $name"
  fi
done

echo "Deploying..."
wrangler deploy

echo "Deployed."
if [[ -n "$D1_ID" ]]; then echo "D1 id suffix: ${D1_ID: -6}"; fi
if [[ -n "$R2_NAME" ]]; then echo "R2 bucket: $R2_NAME"; fi
if [[ -n "$QUEUE_NAME" ]]; then echo "Queue: $QUEUE_NAME"; fi
echo "Worker: https://storybook-ai.<your-subdomain>.workers.dev"
