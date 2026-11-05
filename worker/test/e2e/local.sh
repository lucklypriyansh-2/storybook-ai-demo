#!/usr/bin/env bash
# Full happy-path e2e against `wrangler dev --local` with mocked providers (design §11).
# Jobs run in-process (MOCK_PROVIDERS=1 inline fallback), so no queue draining is needed.
# Requires worker deps installed; seeds invite + budget rows via local D1.
set -euo pipefail

cd "$(dirname "$0")/../.."
BASE="http://127.0.0.1:8787"
JAR="$(mktemp)"
PHOTO="$(mktemp -t storybook-photo).png"
PASS=0

# Prefer a globally-installed wrangler; fall back to the local node_modules binary.
if ! command -v wrangler >/dev/null 2>&1; then
  WRANGLER="./node_modules/.bin/wrangler"
else
  WRANGLER="wrangler"
fi
step() { PASS=$((PASS + 1)); printf '\n[%02d] %s\n' "$PASS" "$1"; }
note() { printf '     %s\n' "$1"; }

cleanup() {
  rm -f "$JAR" "$PHOTO"
  [[ -n "${DEV_PID:-}" ]] && kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

# A real 1x1 PNG so the mime/size checks see a genuine image.
python3 - "$PHOTO" <<'PY'
import base64, sys
sys.argv[1] and open(sys.argv[1], "wb").write(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
PY

# Migrations are idempotent; applying before boot makes the run self-contained.
"$WRANGLER" d1 migrations apply storybook-ai --local --persist-to .mf >/dev/null

MOCK_PROVIDERS=1 "$WRANGLER" dev --local --persist-to .mf --port 8787 &
DEV_PID=$!

for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done

d1() { "$WRANGLER" d1 execute storybook-ai --local --persist-to .mf --command "$1" >/dev/null; }
jqid() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }

step "health"
curl -fsS "$BASE/api/health" | grep -q '"ok":true'
note "worker is up and ok"

step "seed invite code"
d1 "INSERT OR REPLACE INTO invite_codes (code, max_uses, used_count, note) VALUES ('E2E', 5, 0, 'test')"
note "invite E2E seeded"

step "auth: POST /api/auth/invite"
USER_ID="$(curl -fsS -c "$JAR" -H 'content-type: application/json' \
  -d '{"code":"E2E","email":"e2e@example.com"}' "$BASE/api/auth/invite" | jqid user_id)"
[[ -n "$USER_ID" ]] || { echo "no user_id"; exit 1; }
note "session established for user ${USER_ID:0:8}…"

step "kids: POST /api/kids"
KID_ID="$(curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d '{"display_name":"Mira"}' "$BASE/api/kids" | jqid kid_id)"
[[ -n "$KID_ID" ]] || { echo "no kid_id"; exit 1; }
note "kid ${KID_ID:0:8}… created"

step "consent: POST /api/consent"
CONSENT_ID="$(curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d "{\"kid_id\":\"$KID_ID\",\"parent_name\":\"Priyansh\",\"others_consented\":false}" \
  "$BASE/api/consent" | jqid consent_id)"
[[ -n "$CONSENT_ID" ]] || { echo "no consent_id"; exit 1; }
note "consent recorded"

step "photos: POST /api/photos"
PHOTO_ID="$(curl -fsS -b "$JAR" -F "photo=@$PHOTO;type=image/png" "$BASE/api/photos" | jqid photo_id)"
[[ -n "$PHOTO_ID" ]] || { echo "no photo_id"; exit 1; }
note "photo ${PHOTO_ID:0:8}… uploaded to tmp/"

step "character sheet: enqueue + poll"
SHEET_JOB="$(curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d "{\"photo_id\":\"$PHOTO_ID\",\"consent_id\":\"$CONSENT_ID\"}" \
  "$BASE/api/kids/$KID_ID/character_sheet" | jqid job_id)"
[[ -n "$SHEET_JOB" ]] || { echo "no sheet job_id"; exit 1; }
SHEET_STATUS=""
for _ in $(seq 1 30); do
  BODY="$(curl -fsS -b "$JAR" "$BASE/api/jobs/$SHEET_JOB")"
  SHEET_STATUS="$(printf '%s' "$BODY" | jqid status)"
  [[ "$SHEET_STATUS" == "done" || "$SHEET_STATUS" == "failed" ]] && break
  sleep 0.5
done
[[ "$SHEET_STATUS" == "done" ]] || { echo "sheet job ended: $SHEET_STATUS"; exit 1; }
note "sheet job done (progress 100)"

step "assert tmp photo is gone from R2"
if "$WRANGLER" r2 object get "storybook-media/tmp/$PHOTO_ID" --local --persist-to .mf >/dev/null 2>&1; then
  echo "tmp/$PHOTO_ID still present after character sheet"; exit 1
fi
note "tmp/$PHOTO_ID deleted after processing"

step "reels tier=free: enqueue + poll"
REEL_ID="$(curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d "{\"kid_id\":\"$KID_ID\",\"story\":\"Mira and the moon\",\"tier\":\"free\"}" \
  "$BASE/api/reels" | jqid reel_id)"
[[ -n "$REEL_ID" ]] || { echo "no reel_id"; exit 1; }
REEL_STATUS=""
for _ in $(seq 1 30); do
  BODY="$(curl -fsS -b "$JAR" "$BASE/api/reels/$REEL_ID")"
  REEL_STATUS="$(printf '%s' "$BODY" | jqid status)"
  [[ "$REEL_STATUS" == "done" || "$REEL_STATUS" == "failed" ]] && break
  sleep 0.5
done
[[ "$REEL_STATUS" == "done" ]] || { echo "reel ended: $REEL_STATUS"; exit 1; }
SHOT_COUNT="$(printf '%s' "$BODY" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['shots']))")"
[[ "$SHOT_COUNT" == "6" ]] || { echo "expected 6 shots, got $SHOT_COUNT"; exit 1; }
note "reel done with 6 shots"

step "budget: openrouter at cap → paid reel expect 402"
d1 "INSERT OR REPLACE INTO budget_state (provider, total_usd, updated_at) VALUES ('openrouter', 10, 0)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'content-type: application/json' \
  -d "{\"kid_id\":\"$KID_ID\",\"story\":\"Mira and the moon\",\"tier\":\"paid\"}" "$BASE/api/reels")"
[[ "$CODE" == "402" ]] || { echo "expected 402 at budget cap, got $CODE"; exit 1; }
note "paid reel correctly refused with 402 at the \$10 cap"

step "forget child"
curl -fsS -b "$JAR" -X POST "$BASE/api/kids/$KID_ID/forget" | grep -q '"ok":true'
KIDS="$(curl -fsS -b "$JAR" "$BASE/api/kids")"
printf '%s' "$KIDS" | grep -q "$KID_ID" && { echo "kid $KID_ID still listed after forget"; exit 1; }
note "child ${KID_ID:0:8}… gone from the kids list"

printf '\nOK — all %d e2e steps passed.\n' "$PASS"
