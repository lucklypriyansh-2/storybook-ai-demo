# Commands once each key arrives (never echo secrets)

Work on Mac, repo `~/Documents/apps/storybook-ai-demo`, branch `feat/ai-backend`.
`$0` until OpenRouter/fal flags are flipped. Caps: $10 each provider, no auto top-up.

## 1. CLOUDFLARE_API_TOKEN (M0 deploy — free)

```bash
cd ~/Documents/apps/storybook-ai-demo/worker
export CLOUDFLARE_API_TOKEN=…   # do not paste into chat
# optional local session secret for first deploy:
export WORKER_SESSION_SECRET="$(openssl rand -hex 32)"
# leave OPENROUTER_API_KEY / FAL_KEY unset → paid flags stay off
bash deploy.sh
# prints Worker URL + D1/R2/Queue names; secrets go in via stdin wrangler secret put
```

After deploy, seed an invite (replace CODE) and optionally make yourself admin:

```bash
wrangler d1 execute storybook-ai --remote --command \
  "INSERT OR REPLACE INTO invite_codes (code,max_uses,used_count,note) VALUES ('FAMILY1',5,0,'priyansh')"
# after first login, set admin (hash = sha256 of lowercased email):
# wrangler d1 execute storybook-ai --remote --command "UPDATE users SET is_admin=1 WHERE email_hash='…'"
```

Point the SPA at the Worker (build-time only; does not change live Pages until merged to main):

```bash
# in repo root, for a preview build:
VITE_API_URL=https://storybook-ai.<subdomain>.workers.dev npm run build
```

Also set Worker vars after you know the URL:
`PUBLIC_API_BASE` = that Worker origin (for fal signed media), `ALLOWED_ORIGIN` already defaults to GitHub Pages.

## 2. OPENROUTER_API_KEY (paid stills — stay under $10)

```bash
cd ~/Documents/apps/storybook-ai-demo/worker
printf '%s' "$OPENROUTER_API_KEY" | wrangler secret put OPENROUTER_API_KEY
# flip flag (edit wrangler.toml [vars] ENABLE_OPENROUTER="1" then redeploy, or):
wrangler secret put …  # secrets only; for vars:
# wrangler.toml: ENABLE_OPENROUTER = "1"
wrangler deploy
```

Set the OpenRouter dashboard credit limit to $10 (no auto top-up). Worker ledger also hard-stops at $10.

## 3. FAL_KEY (motion / HD tier — stay under $10)

```bash
printf '%s' "$FAL_KEY" | wrangler secret put FAL_KEY
# wrangler.toml: ENABLE_FAL = "1"
wrangler deploy
```

Prepaid $10 on fal, no auto top-up. Worker ledger hard-stops at $10.

## Verify after deploy

```bash
curl -sS "$WORKER_URL/api/health"
# expect flags reflecting what is enabled; kill=false
```

Never put keys in the frontend, commit, chat, or logs.
