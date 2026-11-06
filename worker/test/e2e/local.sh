#!/usr/bin/env bash
# Full happy-path e2e against the portable Node server with mocked providers
# (design §11). Uses a throwaway libSQL file; migrations are applied in-process.
# Jobs run inline, so no queue draining is needed.
set -euo pipefail

cd "$(dirname "$0")/../.."
BASE="http://127.0.0.1:8787"
JAR="$(mktemp)"
PHOTO="$(mktemp -t storybook-photo).png"
DB_DIR="$(mktemp -d -t storybook-db)"
DB_URL="file:${DB_DIR}/worker.db"
PASS=0

step() { PASS=$((PASS + 1)); printf '\n[%02d] %s\n' "$PASS" "$1"; }
note() { printf '     %s\n' "$1"; }

cleanup() {
  rm -f "$JAR" "$PHOTO"
  rm -rf "$DB_DIR"
  [[ -n "${DEV_PID:-}" ]] && kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

# A real 1x1 PNG so the mime/size checks see a genuine image.
python3 - "$PHOTO" <<'PY'
import base64, sys
sys.argv[1] and open(sys.argv[1], "wb").write(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
PY

LIBSQL_URL="$DB_URL" npm run migrate --silent

MOCK_PROVIDERS=1 WORKER_SESSION_SECRET="e2e-not-a-real-secret" \
  LIBSQL_URL="$DB_URL" PORT=8787 \
  npm run start --silent &
DEV_PID=$!

for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done

sqlexec() {
  LIBSQL_URL="$DB_URL" node -e "import('@libsql/client').then(({createClient}) => \
    createClient({url: process.env.LIBSQL_URL}).execute(process.argv[1]))" "$1" >/dev/null
}
jqid() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }

step "health"
curl -fsS "$BASE/api/health" | grep -q '"ok":true'
note "worker is up and ok"

step "seed invite code"
sqlexec "INSERT OR REPLACE INTO invite_codes (code, max_uses, used_count, note) VALUES ('E2E', 5, 0, 'test')"
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

step "assert tmp photo is gone from blobs"
COUNT="$(LIBSQL_URL="$DB_URL" node -e "import('@libsql/client').then(async ({createClient}) => { \
  const c = createClient({url: process.env.LIBSQL_URL}); \
  const r = await c.execute({sql: 'SELECT COUNT(*) FROM blobs WHERE key = ?', args: ['tmp/' + process.argv[1]]}); \
  console.log(r.rows[0][0]); })" "$PHOTO_ID")"
[[ "$COUNT" == "0" ]] || { echo "tmp/$PHOTO_ID still present after character sheet"; exit 1; }
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
sqlexec "INSERT OR REPLACE INTO budget_state (provider, total_usd, updated_at) VALUES ('openrouter', 100, 0)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'content-type: application/json' \
  -d "{\"kid_id\":\"$KID_ID\",\"story\":\"Mira and the moon\",\"tier\":\"paid\"}" "$BASE/api/reels")"
[[ "$CODE" == "402" ]] || { echo "expected 402 at budget cap, got $CODE"; exit 1; }
note "paid reel correctly refused with 402 at the \$100 cap"

step "forget child"
curl -fsS -b "$JAR" -X POST "$BASE/api/kids/$KID_ID/forget" | grep -q '"ok":true'
KIDS="$(curl -fsS -b "$JAR" "$BASE/api/kids")"
printf '%s' "$KIDS" | grep -q "$KID_ID" && { echo "kid $KID_ID still listed after forget"; exit 1; }
note "child ${KID_ID:0:8}… gone from the kids list"

printf '\nOK — all %d e2e steps passed.\n' "$PASS"
