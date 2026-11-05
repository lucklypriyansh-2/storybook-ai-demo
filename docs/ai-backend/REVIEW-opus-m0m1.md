# Opus review — M0/M1 AI backend

Scope: `worker/` as of commit `235493f` on branch `feat/ai-backend`, read against `docs/ai-backend/BUDGET-SECURITY-DESIGN.md` and `docs/plan-ai-real-app.md` §10.

Severity: **HIGH** = must fix before any live key is wired up or any paid traffic; **MED** = correctness/UX gap that will bite in M1 e2e or first demo; **LOW** = quality / tidy-up. Ordered by severity, grouped by theme.

---

## 1. Security

### H-1 — Invite credits are burned on every login, not only on first-time signup
**`src/routes/auth.ts:15-31`** · severity **HIGH**

`validateInvite` + `consumeInvite` run before the user upsert. If the email already exists (`SELECT ... FROM users WHERE email_hash = ?` hits), the code increments `invite_codes.used_count` anyway and then reuses the existing user. A single returning parent exhausts a `max_uses=5` invite in five logins.

**Fix:** move `consumeInvite` into the `if (!user)` branch so only a net-new user consumes a use. For a returning user, still `validateInvite` to confirm the invite exists but do not decrement.

### H-2 — Session ids stored in plaintext in D1
**`src/auth/session.ts:30-43`, `migrations/0001_init.sql:9-14`** · severity **HIGH**

`sessions.id` is the random 32-byte token itself. Anyone with read access to D1 (admin console, future `/api/admin/ledger` extension that joins sessions, a backup dump, a SQL-injection in a future feature) can lift any live session cookie and resume as that user; the HMAC is useless because it is deterministic from the id + secret.

**Fix:** store `sha256(id)` as `sessions.id`; in `resolveSession` hash the cookie id before the SELECT. One line each site, no API change.

### H-3 — Env `KILL_SWITCH=1` does not block paid calls through `guardSpend`
**`src/budget/ledger.ts:39-40` vs `src/budget/kill_switch.ts:5-11`** · severity **HIGH**

`guardSpend` reads `SELECT enabled FROM kill_switch WHERE id = 1` directly — it checks only the D1 row, not the env flag. Design §3.5 says *"env wins over D1"* and `isKilled(env)` honors that, but every paid pre-charge path bypasses `isKilled`. Concretely, `motion_i2v.ts:30-39` jumps straight into `guardSpend` with no `isKilled` check at all, so an in-flight HD reel will keep charging fal after the operator sets `KILL_SWITCH=1` and redeploys.

**Fix:** replace the inline SELECT in `guardSpend` with `await isKilled({ ...env-shape... })`, and also add `if (await isKilled(env)) throw new KillSwitchOn()` at the top of `motion_i2v.ts` before any provider work.

### H-4 — No CORS layer; the real browser frontend cannot call the Worker
**`src/index.ts:8-19`, `src/router.ts:60-68`** · severity **HIGH**

The SPA lives at `lucklypriyansh-2.github.io` and the Worker at `*.workers.dev`. All API calls are cross-origin and use `credentials: "include"` (design §9). No route sets `Access-Control-Allow-Origin`, `-Allow-Credentials`, or responds to `OPTIONS` preflight. Browser blocks every request; the e2e only works because `curl` ignores CORS.

**Fix:** wrap `dispatch` in a CORS layer that (a) short-circuits `OPTIONS` with `Access-Control-Allow-Origin: <pages-origin>`, `-Allow-Credentials: true`, `-Allow-Methods`, `-Allow-Headers: content-type`; (b) echoes the same two headers on every JSON response. Pages origin should be a `vars` entry (e.g. `ALLOWED_ORIGIN`), not hardcoded.

### H-5 — No rate limit on `POST /api/auth/invite`
**`src/routes/auth.ts:10-38`, `src/router.ts:41`** · severity **HIGH**

The only cap on invite-code guessing is `invite_codes.max_uses` (which is per-code, not per-attacker). Any client can POST unlimited `{code, email}` pairs. With short codes (expected from "Priyansh types them manually"), this is a few hours of enumeration. Nothing in `rate_limit.ts` is reachable pre-session, and the Worker's global request cap is 100k/day — plenty for brute force.

**Fix:** add an IP-keyed daily bucket (or sliding window via Durable Object) with a small budget — e.g. 20 failed invite attempts/IP/hour; on exceeded, return 429 without touching the DB. At minimum, require codes ≥ 16 chars of entropy and document it.

### H-6 — Admin gate has no way to produce an admin
**`src/routes/auth.ts:26-27`, `src/auth/middleware.ts:11-15`, `migrations/0001_init.sql:1-7`** · severity **MED**

`users.is_admin` defaults to 0 and nothing in the code ever sets it to 1. `/api/admin/*` is therefore unreachable until someone runs a manual `UPDATE users SET is_admin=1`. That's fine, but it's undocumented and there's no way to bootstrap. The kill switch route is useless as shipped.

**Fix:** document the one-liner in README's "Deploy" section (`wrangler d1 execute storybook-ai --remote --command "UPDATE users SET is_admin=1 WHERE email_hash='<sha256(lower(email))>'"`), or add an `invite_codes.grants_admin INTEGER` column so the first consumer of a specific seeded invite becomes admin.

### H-7 — Photo MIME trust is purely client-declared
**`src/routes/photos.ts:11-20`** · severity **LOW**

`file.type` is whatever the browser (or an attacker) put in the multipart `Content-Type`. No magic-byte sniff. Low blast radius because the only downstream is OpenRouter's image model, which will reject non-images, and the sweep cleans up — but it stores arbitrary bytes under `tmp/<uuid>` with a lying contentType for up to 60s.

**Fix:** sniff the first 12 bytes against JPEG/PNG/WebP signatures (`FF D8 FF`, `89 50 4E 47 0D 0A 1A 0A`, `52 49 46 46 .. .. .. .. 57 45 42 50`) in `photos.upload` and 400 on mismatch.

---

## 2. Budget airtightness

### H-8 — fal `image_url` is a raw R2 object key, not a URL fal can fetch
**`src/providers/fal.ts:27-35`** · severity **HIGH** (correctness that gates the whole motion tier)

`body: JSON.stringify({ image_url: opts.imageKey, ... })` passes `"sheets/<kid_id>/<id>.png"` or similar — a bare R2 key, not an http URL. fal has no way to retrieve it; the first real call will fail with `fal_job_failed` and compensate the pre-charge. The design (§5, §8) and plan (§4) both specify an R2-signed URL.

**Fix:** generate a short-lived signed URL (R2 presign via `env.R2.createPresignedUrl` or by proxying through a `/api/media/:key?sig=...` endpoint signed with `WORKER_SESSION_SECRET`) and pass that URL. Add a unit test asserting the URL starts with `https://`.

### H-9 — `reels.get` returns raw R2 keys, not signed URLs
**`src/routes/reels.ts:81-93`** · severity **HIGH**

Design §6 says the GET response is `{shots:[{keyframe_url, caption}], audio_url?, video_url?}` with "signed URLs 1h". The implementation returns the shot manifest verbatim, which has `keyframe_key` / `video_key` — R2 keys. The frontend can't load them. Pair with H-8: there is no R2 signed-URL helper in the Worker at all.

**Fix:** add `src/storage/r2.ts:signedUrl(key, ttlSec)` and call it in `reels.get` for every `keyframe_key`/`video_key`. If presign isn't practical, implement a proxy GET route that checks session ownership and streams from R2.

### H-10 — HD tier motion enqueue leaks orphan `queued` jobs over the fal cap
**`src/jobs/reel_generate.ts:126-162`** · severity **MED**

`enqueueMotion` does a non-reserving `assertHeadroom` per shot. Under concurrent HD reels, every reel can pass headroom then all enqueue 6 motion jobs that the fal cap can't actually cover. `motion_i2v.ts` will then `guardSpend` → `BudgetExceeded` → `markFailed` for each one. The reel is marked `done` with keyframes only (good), but the parent-job `error` only records skipped-at-enqueue cases, not the later per-shot failures. Result: a reel looks successful but silently has no videos, and dozens of `jobs.status='failed'` rows pile up.

**Fix:** either pre-charge the whole motion budget in a single `guardSpend` before any enqueue (compensate per-shot deltas later), or short-circuit `motion_i2v.ts` to mark failed with `motion_skipped_budget` and roll that into the reel's visible state. Also update `reels.get` to report `shots_with_motion` vs `shots_total`.

### H-11 — Per-shot keyframe pre-charge leaves orphan R2 objects on mid-reel BudgetExceeded
**`src/jobs/reel_generate.ts:45-79`** · severity **MED**

Each of 6 paid keyframes pre-charges $0.039 inside the loop. If shot 6's `guardSpend` throws `BudgetExceeded`, shots 1-5 are already written to R2 and reconciled against the ledger. `markFailed` updates the reel row but does not delete those R2 objects or compensate the already-reconciled spend. Operator has spent real dollars for a failed reel.

**Fix:** pre-charge the full `prechargeUsd("paid")` at the top of `reelGenerateJob` with one `guardSpend`, then `reconcileSpend` to the actual at the end (sum of `out.actualUsd`); on any throw, compensate once and `deletePrefix(env.R2, "reels/<id>/")`. This matches the design's "per-reel" pre-charge model better than per-shot.

### M-12 — `consumeCharacter` / `consumeReel` run before enqueue; failures burn the daily credit
**`src/routes/kids.ts:106-116`, `src/routes/reels.ts:50-63`** · severity **MED**

If `env.JOBS.send()` throws (or the subsequent D1 batch fails and leaves state partly written), the user is already debited one of their 5 chars or 10 reels. No compensation path.

**Fix:** move `consumeCharacter`/`consumeReel` to be the *last* mutating step before returning the response, or wrap the whole route body in a try/catch that calls a `refundDaily(scope, user)` helper on failure.

### M-13 — `reset_daily` runs every minute and does a full-table scan
**`wrangler.toml:27`, `src/scheduled/reset_daily.ts:5-13`** · severity **LOW**

Cron is `* * * * *` (per-minute, for sweep). `index.ts:26` runs both sweep and reset in parallel. `reset_daily` issues `DELETE FROM rate_buckets WHERE key LIKE '%:%' AND key NOT LIKE '%:<today>'` every single minute — 1440 full scans/day of a table that is append-only within a day. Cheap today, not cheap at scale, and violates the design's "daily rollover" cadence.

**Fix:** gate `resetDaily` on `now % 86_400_000 < 60_000` (first minute of UTC day), or split into two cron triggers via `[[triggers]]` with different schedules.

### M-14 — Consumer always acks; queue retries are effectively off
**`src/jobs/consumer.ts:44-51`** · severity **LOW** (contradicts design §7 but code comment acknowledges it)

Design says `max_retries=3` with exponential backoff and re-running the budget guard on each retry. Code always `message.ack()` after a single `runJob`, so transient failures (fal 503, OpenRouter timeout) become terminal. Fine for M1 local, wrong for M3 real traffic.

**Fix:** distinguish retryable (`fetch` failure, `*_http_5*`, `fal_timeout`) from terminal (`BudgetExceeded`, `ProviderDisabled`, `fal_unsafe_input_key`), call `message.retry()` for the former, `message.ack()` for the latter.

### M-15 — Progress calc for keyframes maxes at 60, never reaches 80
**`src/jobs/reel_generate.ts:17,78`** · severity **LOW**

`KEYFRAME_PROGRESS = [20, 40, 60, 80]`; the index is `Math.min(i >> 1, 3)` for i=0..5 → 0,0,1,1,2,2. The `80` entry is unreachable, then it jumps 60 → 100 at the end. Users see a stall from shot 5 onward.

**Fix:** `KEYFRAME_PROGRESS = [15, 25, 40, 55, 70, 85]` indexed by `i` directly.

---

## 3. Privacy

### M-16 — `forget` does not touch `photos_tmp` or `tmp/` objects for the kid
**`src/routes/kids.ts:48-72`** · severity **MED**

`forget` deletes `characters`, `consents`, and reel R2 objects, but ignores `photos_tmp` rows and any orphan `tmp/<uuid>` from an in-flight or recently-failed character-sheet job for that kid. The 60s sweep eventually catches R2 objects, but the DB row linking the user to that upload persists and the window during which a forget doesn't actually remove the photo is up to 60s.

**Fix:** in `forget`, add `SELECT r2_key FROM photos_tmp WHERE user_id = ? AND deleted_at IS NULL` filtered to this kid's in-flight character_sheet jobs (via `jobs.photo_id`), delete those R2 keys immediately, mark the rows `deleted_at`.

### M-17 — `forget` reports a wrong row count
**`src/routes/kids.ts:71`** · severity **LOW**

`rows: 1 + reels.results.length` ignores the deleted `characters` and `consents` rows. Cosmetic but misleading in the admin UI / logs.

**Fix:** sum the actual `meta.changes` from the batch; or just report `{ok:true}` without the count.

### M-18 — `putTmp` doesn't record `user_id` in R2 custom metadata
**`src/storage/r2.ts:7-20`** · severity **LOW**

`sweep_tmp` already uses `photos_tmp` as the source of truth for liveness, so this isn't load-bearing — but a defense-in-depth sweep that could not join against D1 (e.g. during a D1 outage) would have no way to tell whose photo is whose. Also: no `size`/`hash` stored for later forensics.

**Fix:** add `customMetadata: { uploaded_at, user_id, mime }` on put; keep the behavior otherwise unchanged.

---

## 4. Correctness / deploy

### M-19 — `deploy.sh` prints a placeholder Worker URL
**`worker/deploy.sh:67`** · severity **LOW**

Final line: `echo "Worker: https://storybook-ai.<your-subdomain>.workers.dev"`. Operator still has to go look up their subdomain.

**Fix:** parse the URL from `wrangler deploy`'s stdout (it emits `Published storybook-ai (XX sec) https://...`), or query `wrangler deployments list` after deploy.

### M-20 — `reel_generate.ts:33` throws a bare `Error`, not `KillSwitchOn`
**`src/jobs/reel_generate.ts:33`** · severity **LOW**

`throw new Error("kill_switch")` is caught by `runJob` and marked `failed` with reason "kill_switch" — fine functionally, but it skips `KillSwitchOn`'s structured 402 shape and is inconsistent with `character_sheet.ts:33` which throws `KillSwitchOn`.

**Fix:** `throw new KillSwitchOn()`.

### M-21 — SQL built via string interpolation in `admin.ledger`
**`src/routes/admin.ts:12-17`** · severity **LOW**

`${provider ? "WHERE provider = ?" : ""}` is safe today (the ternary picks between two literals), but future hands will interpret the pattern as "concatenation is okay for optional clauses" and introduce injection. Pattern smell.

**Fix:** two prepared statements with explicit `WHERE 1=1 AND provider = COALESCE(?, provider)` or a branch on `provider` returning two fully-literal strings.

---

## 5. Missing tests for the high-severity gaps

### T-22 — Add tests the high items would have caught

Create these alongside existing specs; they would have caught several HIGH items above before now.

- `auth_invite.spec.ts`: a second invite for an existing `email_hash` must NOT increment `used_count` (guards H-1).
- `kill_switch_env.spec.ts`: with `env.KILL_SWITCH="1"` and `kill_switch.enabled=0` in D1, `guardSpend` must throw `KillSwitchOn` and `motion_i2v` must refuse (guards H-3).
- `fal_signed_url.spec.ts`: `makeFalVideo` must be called with an `imageKey` that was first run through a signing helper; assert the body `image_url` starts with `https://` (guards H-8).
- `reels_get.spec.ts`: `/api/reels/:id` response shots have `keyframe_url` starting with `https://`, not raw R2 keys (guards H-9).
- `cors.spec.ts`: an OPTIONS preflight returns 204 with `Access-Control-Allow-Origin` echoing the configured origin; a GET from a different origin is refused (guards H-4).
- `invite_rate_limit.spec.ts`: 21st invite POST from the same IP in an hour returns 429 (guards H-5).
- `reel_cleanup.spec.ts`: a paid reel whose 6th shot throws BudgetExceeded leaves zero R2 keys under `reels/<id>/` and the ledger's `openrouter` total is unchanged from before the reel (guards H-11).

Existing coverage is otherwise solid: ledger atomicity, rate-limit day roll, session HMAC tamper, fal input-key guard, sweep behavior, and forget idempotency are all tested. The gaps are concentrated where the implementation is either still stubbed-for-live (H-8, H-9) or where the *env* variant of a feature differs from the D1 variant (H-3).

---

## Summary table

| ID | Severity | File | Theme |
|---|---|---|---|
| H-1 | HIGH | routes/auth.ts:15 | invite re-consume on login |
| H-2 | HIGH | auth/session.ts:36 | plaintext session ids in D1 |
| H-3 | HIGH | budget/ledger.ts:39 + motion_i2v.ts | env kill switch bypassed |
| H-4 | HIGH | index.ts / router.ts | no CORS |
| H-5 | HIGH | routes/auth.ts:10 | invite endpoint has no rate limit |
| H-6 | MED | migrations/0001_init.sql | no admin bootstrap path |
| H-7 | LOW | routes/photos.ts:11 | MIME is client-declared |
| H-8 | HIGH | providers/fal.ts:31 | raw R2 key sent as image_url |
| H-9 | HIGH | routes/reels.ts:81 | no signed URLs in response |
| H-10 | MED | jobs/reel_generate.ts:126 | HD motion enqueue races the fal cap |
| H-11 | MED | jobs/reel_generate.ts:45 | partial paid-reel orphans R2 + ledger |
| M-12 | MED | routes/kids.ts:106, routes/reels.ts:50 | rate-limit decrement before enqueue |
| M-13 | LOW | wrangler.toml:27 | reset_daily runs every minute |
| M-14 | LOW | jobs/consumer.ts:49 | always-ack disables retries |
| M-15 | LOW | jobs/reel_generate.ts:17 | progress stalls at 60 |
| M-16 | MED | routes/kids.ts:48 | forget ignores photos_tmp |
| M-17 | LOW | routes/kids.ts:71 | forget row count wrong |
| M-18 | LOW | storage/r2.ts:7 | no user_id in R2 metadata |
| M-19 | LOW | deploy.sh:67 | placeholder worker URL |
| M-20 | LOW | jobs/reel_generate.ts:33 | throws Error not KillSwitchOn |
| M-21 | LOW | routes/admin.ts:12 | SQL interpolation pattern |
| T-22 | — | test/unit/ | 7 missing specs for H-items |
