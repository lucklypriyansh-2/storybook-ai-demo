# storybook-ai-worker

Cloudflare Worker backend for the storybook reels app. Implements the budget and
security design in `../docs/ai-backend/BUDGET-SECURITY-DESIGN.md`.

Status: M0/M1 scaffold. Auth, health, consent, kids, photos, reel enqueue, job
status, admin ledger/kill-switch, and the character-sheet job are implemented.
`reel_generate` is a progress-only stub and `motion_i2v` throws until pass 2.

## Run tests

```sh
cd worker
npm install
npm test        # unit tests only; no network, no wrangler
npm run typecheck
```

Unit tests use an in-memory D1 fake (`test/unit/fake-d1.ts`) — no wrangler needed.

## Local dev

```sh
cd worker
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply storybook-ai --local
npm run dev
```

`npm run dev` uses wrangler's local D1/R2/queue simulation. Mocks are forced by
`MOCK_PROVIDERS=1`; no real provider is called. `test/e2e/local.sh` runs a
partial happy path (health + invite + me) against the local server.

## Deploy

```sh
cd worker
CLOUDFLARE_API_TOKEN=... WORKER_SESSION_SECRET=... bash deploy.sh
```

`deploy.sh` fills the `<D1_ID>`, `<R2_BUCKET>`, `<QUEUE_NAME>` placeholders,
applies migrations, pushes secrets from the environment via stdin, and deploys.
Never put secret values in `wrangler.toml`, source, or `.dev.vars` committed to git.

Set `PUBLIC_API_BASE` to the deployed Worker origin so fal gets absolute signed
media URLs, and keep `ALLOWED_ORIGIN` pointed at the Pages origin.

### Granting admin

`users.is_admin` defaults to 0 and nothing in the API sets it, so `/api/admin/*`
is locked until you promote a user directly. After the account has logged in once
(so a `users` row exists), run:

```sh
# sha256 of the lowercased email is the users.email_hash
H=$(printf '%s' 'you@example.com' | shasum -a 256 | cut -d' ' -f1)
npx wrangler d1 execute storybook-ai --remote \
  --command "UPDATE users SET is_admin = 1 WHERE email_hash = '$H'"
```

## Environment

| Name | Where | Purpose |
|---|---|---|
| `DB` | binding | D1 database |
| `R2` | binding | R2 bucket (`tmp/`, `sheets/`, `reels/`) |
| `JOBS` | binding | Queue producer/consumer |
| `AI` | binding | Workers AI (free path) |
| `WORKER_SESSION_SECRET` | secret | HMAC key for session cookies (required) |
| `OPENROUTER_API_KEY` | secret | Paid image/text; unused while `ENABLE_OPENROUTER=0` |
| `FAL_KEY` | secret | Image→video; unused while `ENABLE_FAL=0` |
| `ENABLE_WORKERS_AI` | var | default `1` |
| `ENABLE_OPENROUTER` | var | default `0` |
| `ENABLE_FAL` | var | default `0` |
| `KILL_SWITCH` | var | env wins over the D1 switch |
| `MOCK_PROVIDERS` | var/secret | `1` forces mock adapters |
| `ALLOWED_ORIGIN` | var | CORS origin echoed to the SPA (default Pages origin) |
| `PUBLIC_API_BASE` | var | Worker origin for absolute signed media URLs |

`MOCK_PROVIDERS=1` or a missing provider key always selects mocks, even if the
corresponding `ENABLE_*` flag is on.

## Budget invariants

- Hard cap $10 per paid provider, enforced by an atomic conditional UPDATE.
- Pre-charge before the call, reconcile to `actual_usd` after, compensate on error.
- Per user per UTC day: 5 character sheets, 10 reels.
- Kill switch short-circuits paid calls with HTTP 402 and `{"error":"kill_switch"}`.
