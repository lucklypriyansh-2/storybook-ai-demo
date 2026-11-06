# storybook-ai-worker

Portable Node backend for the storybook reels app. Implements the budget and
security design in `../docs/ai-backend/BUDGET-SECURITY-DESIGN.md`. Runs free on
**Vercel Hobby + Turso (libSQL)** — no Cloudflare, no paid plan required.

Status: M0/M1 + Rev 2 Phase B. Auth, health, consent, kids, photos, reel
enqueue+run, job status, the public catalog, admin catalog CRUD + bootstrap,
character-sheet preview, per-page book text, admin ledger/kill-switch, the
character-sheet job, the reel pipeline, and motion jobs are implemented. Paid
providers are disabled until keys are provided; motion now runs on OpenRouter
(`google/gemini-omni-1.2-flash`) rather than fal. Catalog rows are PLACEHOLDER sample
content owned by this product — no licensed IP is imported.

## Run tests

```sh
cd worker
npm install
npm test        # vitest unit suite, in-memory D1/R2 fakes, no network
npm run typecheck
```

## Local dev

```sh
cd worker
npm install
WORKER_SESSION_SECRET=local-dev-only MOCK_PROVIDERS=1 npm run migrate
WORKER_SESSION_SECRET=local-dev-only MOCK_PROVIDERS=1 npm run dev:node
```

`npm run dev:node` starts the Node HTTP server on `:8787` and runs
`sweepTmp`/`resetDaily`/stale-job recovery on a 60s timer. Jobs execute
in-process via the inline runner.

The libSQL store defaults to `file:./.data/worker.db` (gitignored). Point
`LIBSQL_URL`/`LIBSQL_AUTH_TOKEN` at a Turso database for shared storage.

## Deploy — Vercel Hobby + Turso

One-time setup outside this repo:

1. Create a Turso database (`turso db create storybook-ai`) and grab its
   libSQL URL + auth token.
2. Create a Vercel project linked to this directory (`vercel link`). Hobby
   plan is sufficient; `maxDuration: 60` is set in `vercel.json`.

Then provision secrets + apply migrations + deploy:

```sh
cd worker
LIBSQL_URL="libsql://…"             \
LIBSQL_AUTH_TOKEN="…"               \
WORKER_SESSION_SECRET="…"           \
OPENROUTER_API_KEY="…"              \  # optional; omit to stay on mocks
ALLOWED_ORIGIN="https://lucklypriyansh-2.github.io" \
PUBLIC_API_BASE="https://<your-vercel-app>.vercel.app" \
bash deploy-vercel.sh
```

`deploy-vercel.sh` pipes each present secret into `vercel env add … production`
via stdin (never echoed), runs migrations against the configured libSQL URL,
and runs `vercel deploy --prod`. Missing optional keys are skipped.

### Granting admin

`users.is_admin` defaults to 0. After the account has logged in once (so a
`users` row exists), promote by email hash:

```sh
H=$(printf '%s' 'you@example.com' | shasum -a 256 | cut -d' ' -f1)
LIBSQL_URL="libsql://…" LIBSQL_AUTH_TOKEN="…" \
  node -e "import('@libsql/client').then(({createClient}) => \
    createClient({url: process.env.LIBSQL_URL, authToken: process.env.LIBSQL_AUTH_TOKEN}) \
    .execute({sql: 'UPDATE users SET is_admin = 1 WHERE email_hash = ?', args: [process.argv[1]]}) \
    .then(r => console.log('updated', r.rowsAffected)))" "$H"
```

## Rev 2 Phase B/C routes

```
POST   /api/auth/register                  # { email, password } → session cookie (no invite required)
POST   /api/auth/login                     # { email, password } → session cookie
POST   /api/auth/invite                    # { code, email } → session cookie (legacy)
GET    /api/auth/providers                 # { email, google, invite } — which paths are enabled here
GET    /api/auth/google/start?return_to=…  # 302 to Google; signed state carries return_to
GET    /api/auth/google/callback?code=&state=  # Google OIDC callback; 302 back to return_to with session cookie
GET    /api/catalog                        # enabled templates (public, no session)
GET    /api/catalog/:id                    # template detail + shot meta (public)
GET    /api/kids/:id/character_sheet       # { sheet_url, version, updated_at, hints }; 404 if no blob
PATCH  /api/kids/:id/character_sheet/hints # { hints } → saves the look, spends nothing
POST   /api/kids/:id/character_sheet       # { consent_id, photo_id?, hints? } → render job
PATCH  /api/reels/:id/pages/:index         # { text? , regenerate?: { caption?, keyframe?, hint? } }
DELETE /api/reels/:id/pages/:index         # clears the override (revert to template)
GET    /api/reels                          # rows echo `tier` + `template_id` (no per-reel GET needed)
POST   /api/admin/bootstrap                # X-Admin-Token == ADMIN_TOKEN → is_admin=1 for the session
GET    /api/admin/templates                # requireAdmin
POST   /api/admin/templates                # requireAdmin
PATCH  /api/admin/templates/:id            # requireAdmin
DELETE /api/admin/templates/:id            # requireAdmin
GET    /api/admin/templates/:id/preview    # requireAdmin, `?kid_id=` (A-04)
```

### Per-page regenerate (R.5.1)

`PATCH /api/reels/:id/pages/:index` accepts two independent payloads:

- `{ text }` — save the words verbatim. No AI call, no spend.
- `{ regenerate: { caption?, keyframe?, hint? } }` — ask the AI for new ones.
  Runs through the same provider/ledger stack as every other paid step, so it
  honours the kill switch, the $100 cap and `provider_disabled`.

Responds with the page's *effective* text plus `{ edited, keyframe_edited }` and
`regenerated: ["caption"|"keyframe"|"text"]`, so the client renders the result
without a follow-up GET. There is deliberately no `job_id`: one caption or
keyframe is far below the reel pipeline's cost and the client would otherwise
poll for a sub-second operation.

Keyframe redraws use the image path (mock under `MOCK_PROVIDERS`, OpenRouter
otherwise) and never touch the video provider — a still is not motion.

### Motion (image→video) — OpenRouter Videos (§H)

Motion runs through OpenRouter's Videos API, not fal: one `OPENROUTER_API_KEY`
covers images, text and video. The flow is
`POST /api/v1/videos` (with `frame_images: [{ …, frame_type: "first_frame" }]`)
→ poll `GET /api/v1/videos/{id}` → download `GET .../content`. The default model
is `google/gemini-omni-1.2-flash` at `duration: 3`, `aspect_ratio: "9:16"`,
`generate_audio: false` — about **$0.023–0.025/s**, i.e. **~$0.07 per clip**.

Motion is available when `ENABLE_OPENROUTER=1` **and** `OPENROUTER_API_KEY` is
set; `flags.motion` on `GET /api/health` reports exactly that. `ENABLE_FAL`/
`FAL_KEY` no longer gate HD or motion (`fal.ts` is retained but unused). A failed,
timed-out or unsupported render is an honest failure: the page keeps its still,
`video_url` stays `null`, the ledger pre-charge is compensated, and no bytes are
ever fabricated.

### Character look hints (R.3.2)

`hints` is a closed vocabulary (`skin`, `hair`, `extras`, `outfit`, `style`),
each clamped to 80 characters and stripped of control characters before it
reaches a prompt. `GET .../character_sheet` returns the stored hints or `null`
when the look was never edited. `POST .../character_sheet` accepts optional
`hints` and an optional `photo_id`: with no `photo_id` it regenerates from the
photo the previous sheet used, while that photo is still inside the retention
window, and otherwise fails fast with **400 `photo_expired`** rather than
queueing a job that can only fail later.

### A-04 personalisation preview

`GET /api/admin/templates/:id/preview?kid_id=` composes the preview from
**already-stored** assets: the kid's existing character sheet is the overlay,
and each shot contributes its caption. `keyframe_url` is `null` because catalog
shots store no keyframe, and the SPA draws its bundled placeholder there. No
image is generated for a preview, so nothing is spent; the response says
`live: false` and never claims a provider call. Honest failures: 400
`kid_id_required`, 400 `sheet_required`, 404 `kid_not_found`,
404 `template_not_found`, 404 `template_has_no_shots`.

### Photo retention (24h)

`sweepPhotos` soft-deletes every `photos_tmp` row older than
`PHOTOS_MAX_AGE_MS` (24h) and removes its R2 object first, then `sweepTmp`
collects the `tmp/` orphans that leaves behind. `sweepAll` runs both on the same
60s timer as `resetDaily`. This covers an upload that no job ever claimed, so
the SPA's "deleted within 24 hours" copy is backed by code and tests
(`sweep_tmp.spec.ts`) — not by any claim about the host's cron.

### ffmpeg

Resolution order: `FFMPEG_PATH` → the packaged `ffmpeg-static` binary →
`ffmpeg` on `PATH`. A fire-and-forget probe runs at boot and is cached for
`FFMPEG_PROBE_TTL_MS` (10 min). `GET /api/health` reads **only** the cache, so
it never blocks on a spawn: `flags.ffmpeg` is `null` until a probe has resolved,
then a boolean. Only the flag can become true — motion generation stays paused
while `flags.motion` is false (see §H: motion follows OpenRouter, not fal).

`GET /api/health` reports `sweep: { interval_ms, tmp_max_age_ms,
photos_max_age_ms }`.

### Signup (email+password and Google)

`POST /api/auth/register { email, password }` creates a brand-new account
without an invite code; the response sets the same `sb_session` cookie that the
invite route does. `POST /api/auth/login` accepts the same credentials later.
Passwords are stored as PBKDF2-SHA256 (`210_000` iterations). Both routes
respond with `401 invalid_credentials` for *either* a wrong password or an
unknown email, so neither can be used to enumerate accounts.

Google OAuth (OpenID Connect, auth-code flow) lives at
`GET /api/auth/google/start?return_to=…` → Google → `GET
/api/auth/google/callback`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`GOOGLE_REDIRECT_URI` to turn it on; with any of them unset the routes return
`503 provider_disabled` and the SPA hides the Google button via
`GET /api/auth/providers`. Register the callback URL with Google exactly
matching `GOOGLE_REDIRECT_URI`, e.g.
`https://white-eagle-244989.hostingersite.com/api/auth/google/callback`.

The invite-code route (`POST /api/auth/invite`) stays for existing families and
is advertised as optional; it is no longer the only way in.

### Admin bootstrap

`users.is_admin` is still granted out of band. The bootstrap route is a
convenience: set `ADMIN_TOKEN` in the environment (no value ships in this repo),
sign in as the target account, then

```sh
curl -X POST "$API/api/admin/bootstrap" -H "X-Admin-Token: $ADMIN_TOKEN" -b "sb_session=…"
```

With `ADMIN_TOKEN` unset the route returns **503 `admin_token_unset`**. The token
is compared in constant time, never echoed, and never logged.

## Environment

| Name | Required? | Purpose |
|---|---|---|
| `WORKER_SESSION_SECRET` | yes | HMAC key for session cookies + signed media URLs |
| `ADMIN_TOKEN` | optional | Enables `POST /api/admin/bootstrap`; unset → 503. Never logged. |
| `LIBSQL_URL` | prod | Turso libSQL URL (default `file:./.data/worker.db` locally) |
| `LIBSQL_AUTH_TOKEN` | prod | Turso auth token (omit for `file:` URLs) |
| `OPENROUTER_API_KEY` | optional | Paid image/text **and motion video**; unused while `ENABLE_OPENROUTER=0` or missing |
| `FAL_KEY` | optional | Retained but unused — fal no longer gates or bills motion (§H) |
| `ENABLE_OPENROUTER` | optional | `1` to use real OpenRouter when key present (default `0`); also drives `flags.motion` |
| `ENABLE_FAL` | optional | Retained but unused (default `0`) |
| `KILL_SWITCH` | optional | `1` to short-circuit every paid call with 402 |
| `MOCK_PROVIDERS` | optional | `1` forces mock adapters for every provider |
| `ALLOWED_ORIGIN` | optional | CORS origin (default `https://lucklypriyansh-2.github.io`) |
| `PUBLIC_API_BASE` | optional | Public origin for absolute signed media URLs |
| `FFMPEG_PATH` | optional | Explicit ffmpeg binary; falls back to the packaged `ffmpeg-static`, then `PATH` |
| `GOOGLE_CLIENT_ID` | optional | Google OAuth client id; unset → `/api/auth/google/*` returns 503 and `/api/auth/providers` reports `google: false` |
| `GOOGLE_CLIENT_SECRET` | optional | Google OAuth client secret; required alongside `GOOGLE_CLIENT_ID` |
| `GOOGLE_REDIRECT_URI` | optional | Absolute HTTPS URL Google redirects to, e.g. `https://white-eagle-244989.hostingersite.com/api/auth/google/callback`. Must match what is registered in the Google Cloud console. |

`MOCK_PROVIDERS=1` or a missing provider key always selects mocks, even if the
corresponding `ENABLE_*` flag is on.

## Budget invariants

- Hard cap $100 per paid provider for OpenRouter (images + text + motion share it), enforced by an atomic conditional UPDATE. `fal` cap stays at $10 and is unused (§H).
- Pre-charge before the call, reconcile to `actual_usd` after, compensate on error.
- Per user per UTC day: 5 character sheets, 10 reels.
- Kill switch short-circuits paid calls with HTTP 402 and `{"error":"kill_switch"}`.
- `MOCK_PROVIDERS=1` or `ENABLE_*=0` paths spend $0 (ledger stays at 0).
