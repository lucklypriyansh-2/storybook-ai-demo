# Budget & Security Design — M0/M1 Worker

Scope: concrete design for `worker/` on Cloudflare (TS + wrangler). No code. Implements plan §10 overrides: invite-code auth, no Access/Resend, no domain, hard $10 caps per provider, fal motion in v1. Keys arrive later as `CLOUDFLARE_API_TOKEN`, `OPENROUTER_API_KEY`, `FAL_KEY`. Never echo or embed keys.

---

## 1. File / module layout

```
worker/
  wrangler.toml              # placeholders: <D1_ID>, <R2_BUCKET>, <QUEUE_NAME>
  package.json               # wrangler, typescript, vitest, miniflare
  tsconfig.json
  migrations/                # D1 SQL, numbered 0001_*.sql ...
  src/
    index.ts                 # fetch() entry, routes to router; queue() consumer entry; scheduled() cron entry
    router.ts                # itty-router style; mounts /api/* handlers
    env.d.ts                 # Env bindings type
    config/
      flags.ts               # ENABLE_OPENROUTER, ENABLE_FAL, ENABLE_WORKERS_AI, KILL_SWITCH (read from env + D1 override)
      costs.ts               # pinned USD cost table (see §12)
      limits.ts              # per-user daily caps (5 chars, 10 reels), global caps ($10/provider)
      models.ts              # pinned model ids (gemini-2.5-flash-image, wan-2.1 i2v, flux-1-schnell, llama-3.1-8b)
    auth/
      invite.ts              # validate invite code against invite_codes table
      session.ts             # sign/verify session cookie using WORKER_SESSION_SECRET (HMAC-SHA256)
      middleware.ts          # requireSession() → 401 if missing/invalid
    routes/
      health.ts              # GET /api/health
      auth.ts                # POST /api/auth/invite, POST /api/auth/logout, GET /api/auth/me
      kids.ts                # characters (list/create/delete/forget)
      photos.ts              # POST /api/photos (R2 tmp upload), only referenced by sheet job
      reels.ts               # POST /api/reels (enqueue), GET /api/reels, GET /api/reels/:id
      jobs.ts                # GET /api/jobs/:id (status + progress)
      consent.ts             # POST /api/consent (parent affirmations, name typed)
      admin.ts               # GET /api/admin/ledger, POST /api/admin/kill-switch (session has is_admin=true)
    jobs/
      consumer.ts            # export default queue() handler; dispatches by job.type
      character_sheet.ts     # read tmp photo → openrouter gemini-image → write sheet to R2 → delete tmp photo
      reel_generate.ts       # shot list → 6 keyframes (paid or free) → compose metadata → done (no motion)
      motion_i2v.ts          # per-shot fal image→video; writes mp4 segments to R2
    storage/
      r2.ts                  # put/get/delete helpers; key conventions: tmp/<uuid>, sheets/<kid_id>/<sheet_id>.png, reels/<reel_id>/...
      d1.ts                  # prepared statement helpers, migration runner
    budget/
      ledger.ts              # recordCall(), currentSpend(provider), guardSpend(provider, estUsd) → throws BudgetExceeded
      rate_limit.ts          # token-bucket in D1 (rate_buckets table); per user per endpoint
      kill_switch.ts         # isKilled(); flip via admin route
    providers/
      types.ts               # Adapter interfaces: ImageGen, TextGen, VideoGen
      openrouter.ts          # calls OpenRouter; sets provider.data_collection="deny"; pinned models
      fal.ts                 # fal queue API; image→video only
      workers_ai.ts          # env.AI.run() wrappers
      mock.ts                # test doubles returning fixtures
      index.ts               # pickProvider(step, flags) → routes to free/paid adapter
    scheduled/
      sweep_tmp.ts           # delete R2 tmp/* older than 60s (runs every minute)
      reset_daily.ts         # (optional) daily partition rollover for budget_state
    util/
      errors.ts              # BudgetExceeded, RateLimited, Unauthorized → status mapping
      hash.ts                # HMAC helpers
      uuid.ts
  test/
    unit/*.spec.ts           # ledger, rate_limit, session, invite, provider mocks
    e2e/local.sh             # wrangler dev --local script exercising full happy path
```

---

## 2. D1 schema (migrations list)

- `0001_init.sql` — users, sessions, invite_codes, kids, consents
- `0002_media.sql` — characters (sheets), photos_tmp
- `0003_pipeline.sql` — reels, jobs
- `0004_budget.sql` — ledger, budget_state, kill_switch, rate_buckets

Columns (all `id TEXT PRIMARY KEY` = uuid v4 unless noted):

```
users(id, email_hash, invite_code, is_admin INTEGER, created_at INTEGER)
sessions(id, user_id, expires_at INTEGER, created_at INTEGER)       -- id = random 32B base64url
invite_codes(code PRIMARY KEY, max_uses INTEGER, used_count INTEGER, note TEXT)
kids(id, user_id, display_name, created_at, deleted_at INTEGER NULL)
consents(id, user_id, kid_id, parent_name TEXT, others_consented INTEGER, created_at)
characters(id, kid_id, sheet_r2_key TEXT, model TEXT, created_at)
photos_tmp(id, user_id, r2_key TEXT, created_at INTEGER, deleted_at INTEGER NULL)
reels(id, user_id, kid_id, status TEXT, tier TEXT, story TEXT, created_at)
  -- status: queued|running|done|failed  tier: free|paid|hd
jobs(id, reel_id NULL, kid_id NULL, type TEXT, status TEXT, progress INTEGER,
     error TEXT, attempt INTEGER, created_at, updated_at)
  -- type: character_sheet|reel_generate|motion_i2v
ledger(id, user_id, provider TEXT, model TEXT, step TEXT, est_usd REAL,
       actual_usd REAL NULL, request_id TEXT, created_at INTEGER)
budget_state(provider TEXT PRIMARY KEY, total_usd REAL, updated_at INTEGER)
  -- single row per provider; updated inside same transaction as ledger insert
kill_switch(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER, reason TEXT, updated_at INTEGER)
rate_buckets(key TEXT PRIMARY KEY, tokens REAL, updated_at INTEGER)
  -- key = <scope>:<user_id>:<yyyymmdd>, e.g. "reels:abc:20261105"
```

Indexes: `ledger(user_id, created_at)`, `ledger(provider, created_at)`, `jobs(status, type)`, `reels(user_id, created_at)`, `photos_tmp(created_at)` (for sweeper), `sessions(user_id)`.

---

## 3. Budget ledger rules

Invariants:

1. **Global hard stop per provider: $10.** `budget_state.total_usd` tracked in D1. Checked before every paid call. Checked under row lock (D1 serial write ordering).
2. **Per-user per day:** 5 characters, 10 reels. Enforced via `rate_buckets` using fixed daily windows (`yyyymmdd` in key). Reel endpoint decrements the `reels:<user>:<day>` bucket; sheet creation decrements `chars:<user>:<day>`.
3. **Pre-call guard:** `guardSpend(provider, estUsd)` runs inside a D1 transaction:
   - read `budget_state.total_usd`
   - if `total + estUsd > 10.00` → throw `BudgetExceeded` → handler returns **402** with `{error:"budget_exceeded", provider, remaining_usd}`
   - else insert ledger row with `est_usd`, update `budget_state.total_usd += estUsd`
   - returns `ledger_id`
4. **Post-call reconcile:** after provider returns, update that ledger row with `actual_usd` and delta-correct `budget_state.total_usd`. On provider error, delete the pre-charge (compensating entry).
5. **Kill switch:** `kill_switch.enabled=1` or env `KILL_SWITCH=1` → every paid call short-circuits to **402** `{error:"kill_switch"}`. Flipped by admin route or by setting the env var and redeploying (env wins).
6. **Feature flags** (env vars + D1 override in `kill_switch` style single-row tables if needed):
   - `ENABLE_WORKERS_AI=1` (default on; free path)
   - `ENABLE_OPENROUTER=0` (flip on when `OPENROUTER_API_KEY` set + Priyansh approves)
   - `ENABLE_FAL=0` (flip on at M3)
   A disabled provider adapter throws `ProviderDisabled` → 503 `{error:"provider_disabled"}`.
7. **No auto top-up.** Nothing in the Worker calls provider billing APIs. On 402 the only path forward is manual: Priyansh raises the cap in `limits.ts` constant and redeploys.

Edge cases: queue jobs re-check the ledger on each retry; a job that would exceed is marked `failed` with reason `budget_exceeded` (not retried).

---

## 4. Auth (invite-code only, v1)

- `invite_codes` table seeded manually by Priyansh via `wrangler d1 execute` during M0.
- `POST /api/auth/invite { code, email }`:
  - Lookup code; if `used_count >= max_uses` → 401.
  - Upsert user by `email_hash = sha256(lowercase(email))`. No email send — email is just a label, not verified in v1.
  - Increment `used_count`.
  - Create `sessions` row; set cookie `sb_session=<id>.<hmac>` with `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (30d sliding).
  - `hmac = HMAC-SHA256(WORKER_SESSION_SECRET, id)` — base64url, 32B. Validated on every request.
- `WORKER_SESSION_SECRET` stored via `wrangler secret put`; rotated by invalidating all sessions (truncate `sessions`).
- `GET /api/auth/me` → `{user_id, is_admin}`. `POST /api/auth/logout` deletes session row.
- No Access, no Resend, no OAuth, no password.

---

## 5. Photo privacy

- `POST /api/photos` (multipart): size ≤ 8 MB, mime allow-list [`image/jpeg`,`image/png`,`image/webp`]. Writes to R2 at `tmp/<uuid>` with custom metadata `uploaded_at=<ms>`. Inserts `photos_tmp` row. Returns `{photo_id}`.
- `POST /api/kids/:id/character_sheet { photo_id, consent_id }` enqueues a `character_sheet` job referencing `photo_id`.
- `character_sheet` job:
  1. Load photo bytes from R2.
  2. Call OpenRouter Gemini image with character-sheet prompt (§plan 5.1). Request body MUST include:
     ```
     { "model": "google/gemini-2.5-flash-image",
       "messages": [...multi-modal with image_url...],
       "provider": { "data_collection": "deny",
                     "allow_fallbacks": false,
                     "require_parameters": true } }
     ```
     Headers: `Authorization: Bearer ${OPENROUTER_API_KEY}`, `HTTP-Referer: https://lucklypriyansh-2.github.io/storybook-ai-demo`, `X-Title: storybook-ai-demo`.
  3. On success: write sheet to R2 at `sheets/<kid_id>/<sheet_id>.png`; insert `characters` row.
  4. **Immediately delete source**: `R2.delete(tmp/<uuid>)`, update `photos_tmp.deleted_at`.
  5. If step 2 fails: still delete source photo; mark job `failed`.
- `scheduled/sweep_tmp` runs every minute (wrangler cron `* * * * *`): lists `tmp/`, deletes any object with `uploaded_at < now - 60_000`; also deletes R2 orphans (no matching `photos_tmp` row) older than 60s.
- fal adapter asserts input is a `sheets/*` or `reels/*` key, never `tmp/*`. Violation → runtime error, not request.
- Allowed-model list in `models.ts` is the only surface permitted to receive a raw photo (character-sheet model id). All other calls that would include image_input assert the ref is a sheet key.

---

## 6. API routes

Session required unless noted. All responses JSON. `429` = rate limited, `402` = budget/kill-switch, `401` = no/invalid session, `403` = consent missing, `400` = validation.

| Method | Path | Auth | Request | Response | Codes |
|---|---|---|---|---|---|
| GET | `/api/health` | no | — | `{ok:true, build, flags:{openrouter,fal,workers_ai,kill}}` | 200 |
| POST | `/api/auth/invite` | no | `{code, email}` | `{user_id, is_admin}` + `Set-Cookie` | 200/401 |
| GET | `/api/auth/me` | yes | — | `{user_id, is_admin}` | 200/401 |
| POST | `/api/auth/logout` | yes | — | `{ok:true}` | 200 |
| POST | `/api/consent` | yes | `{kid_id, parent_name, others_consented:boolean}` | `{consent_id}` | 200/400 |
| GET | `/api/kids` | yes | — | `{kids:[{id, display_name, has_sheet}]}` | 200 |
| POST | `/api/kids` | yes | `{display_name}` | `{kid_id}` | 200 |
| POST | `/api/kids/:id/forget` | yes | — | `{ok:true, deleted:{r2:n, rows:n}}` | 200 |
| POST | `/api/photos` | yes | multipart `photo` | `{photo_id}` | 200/400 |
| POST | `/api/kids/:id/character_sheet` | yes | `{photo_id, consent_id}` | `{job_id}` | 200/402/403/429 |
| POST | `/api/reels` | yes | `{kid_id, story, tier:"free"\|"paid"\|"hd"}` | `{reel_id, job_id}` | 200/402/429 |
| GET | `/api/reels` | yes | — | `{reels:[{id, status, created_at}]}` | 200 |
| GET | `/api/reels/:id` | yes | — | `{id, status, tier, shots:[{keyframe_url, caption}], audio_url?, video_url?}` (signed URLs 1h) | 200/404 |
| GET | `/api/jobs/:id` | yes | — | `{id, type, status, progress, error?}` | 200/404 |
| GET | `/api/admin/ledger` | admin | `?provider=` | `{totals:{openrouter,fal}, rows:[...]}` | 200/403 |
| POST | `/api/admin/kill-switch` | admin | `{enabled:boolean, reason?}` | `{enabled}` | 200/403 |

---

## 7. Queue consumer

Binding: `env.JOBS` (producer) + `queue()` export (consumer). One message = one job id (jobs live in D1 for state, queue carries only `{job_id}`).

Job types:

- **character_sheet** — see §5. `progress`: 10 (started) → 60 (model returned) → 90 (R2 written) → 100 (photo deleted).
- **reel_generate** — tiers:
  - `free`: Workers AI llama shot-list + flux-schnell keyframes (no multi-ref). ~6 reels/day account-wide.
  - `paid`: OpenRouter gemini-2.5-flash text + gemini-2.5-flash-image keyframes (multi-ref to character sheet).
  - `hd`: paid path + enqueues 6 `motion_i2v` sub-jobs on completion.
  `progress`: 5/20/40/60/80/100 after shot list, each pair of keyframes, compose metadata.
- **motion_i2v** — one per shot. Input: keyframe R2 key. Output: mp4 segment R2 key. Assert input key startsWith `sheets/`/`reels/`.

Idempotency: consumer checks `jobs.status` before doing work; if already `done` or `failed`, ack and return. Each worker-step writes progress to D1. Retries: queue `max_retries=3` with exponential backoff; on each retry re-run budget guard; on `BudgetExceeded`/`ProviderDisabled` mark `failed` and do not re-queue.

---

## 8. Provider adapters

Interface (`providers/types.ts`):

```
interface ImageGen {
  id: "openrouter-gemini-2.5-flash-image" | "wai-flux-1-schnell" | "mock-image";
  estUsd(opts): number;                  // from costs.ts
  generate(opts): Promise<{bytes, actualUsd?}>;
}
interface TextGen  { id; estUsd; complete(opts): Promise<{text, actualUsd?}>; }
interface VideoGen { id; estUsd; i2v(opts): Promise<{bytes, seconds, actualUsd?}>; }
```

Implementations:

- **openrouter.ts** — `POST https://openrouter.ai/api/v1/chat/completions`. Models pinned: `google/gemini-2.5-flash` (text), `google/gemini-2.5-flash-image` (character sheet + paid keyframes). Every body sets `provider: { data_collection: "deny", allow_fallbacks: false, require_parameters: true }` to enforce ZDR.
- **fal.ts** — `POST https://queue.fal.run/fal-ai/wan-2.1/image-to-video` (or `alibaba/wan-3.0/image-to-video` per plan). Poll `GET status` until `COMPLETED`. Input image is R2-signed URL of a **sheet/reel** key (asserted). `estUsd = seconds * $0.01` from cost table.
- **workers_ai.ts** — `env.AI.run("@cf/meta/llama-3.1-8b-instruct", ...)` and `env.AI.run("@cf/black-forest-labs/flux-1-schnell", ...)`. estUsd = 0 but counts toward neuron bucket (`rate_buckets` key `wai:global:<yyyymmdd>`).
- **mock.ts** — deterministic fixtures (same bytes per prompt hash). Used in all unit tests and in e2e when `MOCK_PROVIDERS=1`.

Router (`providers/index.ts`): given `(step, tier)` and current flags, returns the live adapter or mock. If a disabled provider is selected → throw `ProviderDisabled`.

---

## 9. Frontend switch

- Frontend reads `import.meta.env.VITE_API_URL`.
- `src/data/api.ts`: `export const api = VITE_API_URL ? new WorkerApi(VITE_API_URL) : new LocalApi()`.
- `WorkerApi` wraps `fetch(..., { credentials: "include" })` against the routes in §6; shapes match existing `LocalApi` methods so views don't change.
- No keys, no provider URLs, no model ids ever touch the bundle.
- 402/429/401 surface as typed errors the UI maps to existing paywall/limit modals (mock paywall is fine for v1).

---

## 10. deploy.sh contract

Script `worker/deploy.sh`, invoked with env preset (`CLOUDFLARE_API_TOKEN` required; `OPENROUTER_API_KEY`, `FAL_KEY`, `WORKER_SESSION_SECRET` optional and set only if present):

1. Assert `CLOUDFLARE_API_TOKEN` is set; exit 1 otherwise. Never print it (`set +x`, no `echo $VAR`).
2. If `wrangler.toml` still contains `<D1_ID>`:
   - `wrangler d1 create storybook-ai` → capture id (`jq`), sed-replace `<D1_ID>` in wrangler.toml.
3. If still contains `<R2_BUCKET>`:
   - `wrangler r2 bucket create storybook-media` → sed-replace.
4. If still contains `<QUEUE_NAME>`:
   - `wrangler queues create storybook-jobs` → sed-replace.
5. `wrangler d1 migrations apply storybook-ai --remote`.
6. For each secret var present in env: `printf '%s' "$VAL" | wrangler secret put NAME` (stdin pipe, no args, no logs). Never `echo`.
7. `wrangler deploy`.
8. Print only: worker URL, D1 id suffix, R2 bucket name, queue name. No secrets.

`wrangler.toml` shape:

```
name = "storybook-ai"
main = "src/index.ts"
compatibility_date = "2026-11-01"
[[d1_databases]]       binding="DB"   database_name="storybook-ai" database_id="<D1_ID>"
[[r2_buckets]]         binding="R2"   bucket_name="<R2_BUCKET>"
[[queues.producers]]   binding="JOBS" queue="<QUEUE_NAME>"
[[queues.consumers]]   queue="<QUEUE_NAME>" max_batch_size=1 max_retries=3
[ai]                   binding="AI"
[triggers]             crons=["* * * * *"]
[vars]                 ENABLE_WORKERS_AI="1" ENABLE_OPENROUTER="0" ENABLE_FAL="0" KILL_SWITCH="0"
```

---

## 11. Test plan

Unit (vitest + miniflare):

- `ledger.spec.ts` — guardSpend: approves under cap, throws at cap, reconciles post-call delta, compensates on provider error.
- `rate_limit.spec.ts` — 5 chars/day, 10 reels/day enforced; resets at UTC day boundary.
- `session.spec.ts` — HMAC round-trip; tampered cookie rejected; expired session rejected.
- `invite.spec.ts` — rejects unknown code; decrements used_count; rejects when exhausted.
- `providers.mock.spec.ts` — openrouter adapter sets `provider.data_collection: "deny"`; fal adapter refuses `tmp/*` input; workers_ai adapter increments neuron bucket.
- `sweep_tmp.spec.ts` — deletes R2 objects older than 60s; leaves younger alone; handles orphans.
- `forget.spec.ts` — `/api/kids/:id/forget` removes rows + R2 objects; idempotent.

E2E — `test/e2e/local.sh`:

```
MOCK_PROVIDERS=1 wrangler dev --local --persist-to .mf &
# 1. health
# 2. seed invite code via d1 execute
# 3. POST /api/auth/invite  → cookie
# 4. POST /api/consent
# 5. POST /api/kids
# 6. POST /api/photos (sample.jpg)
# 7. POST /api/kids/:id/character_sheet  → poll /api/jobs/:id until done
# 8. assert R2 tmp/<uuid> is gone (wrangler r2 object get → 404)
# 9. POST /api/reels tier=free  → poll until done; assert signed urls valid
#10. set budget_state.total_usd=10 for openrouter; POST reels tier=paid → expect 402
#11. POST /api/kids/:id/forget → assert characters, reels, R2 sheets gone
```

CI gate: unit tests + e2e dry-run with `MOCK_PROVIDERS=1`. No real provider call in CI.

---

## 12. Cost table (USD, pinned 2026-11-05)

Used by `estUsd()` in adapters and by `guardSpend()` pre-check. Update requires PR.

| step | provider | model | unit | price |
|---|---|---|---|---|
| shot_list | openrouter | google/gemini-2.5-flash | per call (~1200 tokens) | 0.0002 |
| shot_list_free | workers_ai | @cf/meta/llama-3.1-8b-instruct | per call | 0 |
| character_sheet | openrouter | google/gemini-2.5-flash-image | per image | 0.039 |
| keyframe_paid | openrouter | google/gemini-2.5-flash-image | per image (×6/reel) | 0.039 |
| keyframe_free | workers_ai | @cf/black-forest-labs/flux-1-schnell | per image | 0 |
| motion_i2v | fal | fal-ai/wan-2.1/image-to-video (or alibaba/wan-3.0) | per second (×15/reel) | 0.010 |
| tts | — | Kokoro in-browser | — | 0 |
| music | — | CC0 bundled | — | 0 |
| compose | — | in-browser MediaRecorder | — | 0 |

Pre-charge per reel: free=$0, paid=$0.0002+6×$0.039=$0.2342, hd=paid+15×$0.01=$0.3842. Character sheet one-time=$0.039.

Caps (hard-stop in Worker, §10 overrides plan §0):
- openrouter: $10 global
- fal: $10 global
- per user/day: 5 characters, 10 reels
- global/day soft alert at $2 (log only; no auto-stop beyond provider caps)
