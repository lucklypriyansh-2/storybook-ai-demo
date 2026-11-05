# storybook-ai-worker

Portable Node backend for the storybook reels app. Implements the budget and
security design in `../docs/ai-backend/BUDGET-SECURITY-DESIGN.md`. Runs free on
**Vercel Hobby + Turso (libSQL)** — no Cloudflare, no paid plan required.

Status: M0/M1. Auth, health, consent, kids, photos, reel enqueue+run, job
status, admin ledger/kill-switch, character-sheet job, reel pipeline, and
motion jobs all implemented. fal is disabled until keys are provided.

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

## Environment

| Name | Required? | Purpose |
|---|---|---|
| `WORKER_SESSION_SECRET` | yes | HMAC key for session cookies + signed media URLs |
| `LIBSQL_URL` | prod | Turso libSQL URL (default `file:./.data/worker.db` locally) |
| `LIBSQL_AUTH_TOKEN` | prod | Turso auth token (omit for `file:` URLs) |
| `OPENROUTER_API_KEY` | optional | Paid image/text; unused while `ENABLE_OPENROUTER=0` or missing |
| `FAL_KEY` | optional | Image→video; unused while `ENABLE_FAL=0` or missing |
| `ENABLE_OPENROUTER` | optional | `1` to use real OpenRouter when key present (default `0`) |
| `ENABLE_FAL` | optional | `1` to use real fal when key present (default `0`) |
| `KILL_SWITCH` | optional | `1` to short-circuit every paid call with 402 |
| `MOCK_PROVIDERS` | optional | `1` forces mock adapters for every provider |
| `ALLOWED_ORIGIN` | optional | CORS origin (default `https://lucklypriyansh-2.github.io`) |
| `PUBLIC_API_BASE` | optional | Public origin for absolute signed media URLs |

`MOCK_PROVIDERS=1` or a missing provider key always selects mocks, even if the
corresponding `ENABLE_*` flag is on.

## Budget invariants

- Hard cap $10 per paid provider, enforced by an atomic conditional UPDATE.
- Pre-charge before the call, reconcile to `actual_usd` after, compensate on error.
- Per user per UTC day: 5 character sheets, 10 reels.
- Kill switch short-circuits paid calls with HTTP 402 and `{"error":"kill_switch"}`.
- `MOCK_PROVIDERS=1` or `ENABLE_*=0` paths spend $0 (ledger stays at 0).
