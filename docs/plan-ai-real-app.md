# Plan: real AI storybook reels app (PLAN ONLY, $0 spent, 5 Nov 2026 IST)
Drafted by Claude Opus (claude-opus-4-7 via `gmclaude claude`, MCP off) from a facts brief with live prices; edited by Grok Bot (section 10 corrections). Raw Opus output: Mac ~/Documents/apps/reels-plan-review/ai-real-plan-opus.txt.
Price sources (checked 5 Nov 2026): https://openrouter.ai/api/v1/models (live model list; no video models, no /videos endpoint), https://fal.ai/pricing, https://fal.ai/explore/image-to-video-apis, https://fal.ai/models/alibaba/wan-3.0/image-to-video, https://developers.cloudflare.com/workers-ai/platform/pricing/, https://developers.cloudflare.com/r2/pricing/

# Storybook Reels → Real AI App: Architecture Plan

Date: 2026-11-05 · Author: Claude (architect) for Priyansh
Scope: turn the current in-browser mock (v1 live at lucklypriyansh-2.github.io/storybook-ai-demo/app/) into a real generative pipeline with keys off the client, costs bounded, kids' photos handled safely.

---

## 0. Decisions (locked unless flagged)

1. **Backend: Cloudflare Workers + D1 + R2 + Queues.** Rationale in §1. Priyansh creates one Cloudflare API token; everything else via `wrangler` CLI from the shell.
2. **AI routing: OpenRouter for image + text + TTS; fal.ai for image→video; Cloudflare Workers AI as free-tier fallback.** One OpenRouter key, one fal key. No direct provider keys.
3. **Reels v1 = stills + Ken Burns + TTS + music** (reuses existing in-browser `MediaRecorder` renderer). Motion video (fal i2v) is an opt-in "HD" tier gated behind paid.
4. **Identity consistency = Gemini image models with multi-reference image_input** (character sheet + per-shot prompt). No fine-tuning, no LoRA training on kids' photos — ever.
5. **Source photo deleted from storage within 60s of character sheet creation.** Only the stylised, non-photoreal character sheet persists. §6.
6. **Auth: Cloudflare Access + email OTP** (no passwords, no social providers that index kids). One account per parent; kids are sub-profiles under parent.
7. **Budgets: hard caps enforced in Worker** — $0.50/user/day free tier, $5/user/day paid, $20/day global kill-switch. Exceeding returns 402 + queues for next day.
8. **Spend posture: $0 until §8 signoff.** Free tier = Cloudflare WAI + Kokoro TTS in-browser + CC0 music. First paid key is OpenRouter at $10 prepay.
9. **Repo stays public, GitHub Pages stays as the static host.** Worker is a separate `api.<domain>` origin. No keys ever shipped to the Pages bundle.

Flagged for Priyansh: item 7 budget numbers, item 8 first-spend amount.

---

## 1. Backend comparison & recommendation

| Dimension | Cloudflare (Workers + D1 + R2 + Queues) | Supabase | Firebase |
|---|---|---|---|
| Signup path from Priyansh's box | API token he pastes → `wrangler` does everything via CLI | supabase.com blocked in his browser; needs access token he generates on a different device, then `supabase` CLI works | Google-only signup; browser works, but gcloud project creation needs console clicks |
| Free tier fit | Workers 100k req/day, D1 5GB, R2 10GB + **zero egress**, Queues 1M msg/mo, Workers AI 10k neurons/day (flux-schnell, MeloTTS, Llama) | 500MB Postgres, 1GB storage, 2GB egress/mo, 50k MAU auth, Edge Functions 500k/mo | Spark: Firestore 1GB + 50k reads/day, Storage 5GB + 1GB egress/day, Functions require Blaze (card) |
| Egress on video blobs | **$0** (R2) — matters because reels are 1-5 MB each | $0.09/GB after 2GB | $0.12/GB after 1GB |
| Queue for slow jobs | Built-in Queues, same account | Needs pg_cron or external (Inngest/Trigger.dev) | Cloud Tasks, Blaze-gated |
| Edge compute near user | Default | Edge Functions (Deno) in select regions | Cloud Functions (regional) |
| Vendor lock-in on data | SQLite dialect (D1), portable | Postgres, fully portable | Firestore, proprietary |
| Kids-photo story | We control deletion in R2 directly | Same, but storage is S3-compat under the hood | GCS, Google retention policies apply |
| Cost at 1k reels/mo | ~$0 (within free) | ~$0-5 (egress) | Blaze required, ~$5-15 |

**Recommendation: Cloudflare.** Three reasons that matter for *this* app:

- **R2 zero egress** is decisive. Reels are the payload; every view is a download. On Supabase/Firebase a reel going mildly viral prints money.
- **One CLI, one token.** Priyansh creates a Cloudflare API token (Account:Workers Scripts:Edit + D1:Edit + R2:Edit + Queues:Edit) and the shell does the rest. Supabase works too but adds a browser-side step he can't do in the box. Firebase needs console clicks.
- **Workers AI free tier** (flux-1-schnell + MeloTTS + Llama) gives us a working zero-dollar fallback for the "free user" segment before OpenRouter ever gets called.

Trade-off accepted: D1 is SQLite-flavored and smaller than Postgres. This app's schema is ~6 tables; we won't notice. If we outgrow it, the IndexedDB-adapter pattern already proves the data layer is swappable.

---

## 2. Pipeline per step: model, provider, price

One reel = one story (300-600 chars) → 6 shots → 6 keyframes → optional 6×2.5s motion → TTS narration → music → compose.

| Step | Default model (cheapest working) | Upgrade (better quality) | Unit | Price/unit | Per 15s reel |
|---|---|---|---|---|---|
| 1. Shot list from story | `google/gemini-2.5-flash` via OpenRouter | `google/gemini-3-pro` | ~800 in + 400 out tokens | ~$0.0002 | $0.0002 |
| 2. Character sheet (one-time per child) | `google/gemini-2.5-flash-image` (multi-ref) | `google/gemini-3-pro-image` | 1 image | $0.039 / $0.155 | amortized, see §3 |
| 3. Per-shot keyframes (6 shots) | `google/gemini-2.5-flash-image` with char sheet as ref | `google/gemini-3.1-flash-image` | 6 images | 6 × $0.039 = $0.234 | $0.234 (cheap) / 6 × $0.077 = $0.462 (better) |
| 4a. Stills + Ken Burns (default) | existing in-browser compose | — | — | $0 | $0 |
| 4b. Motion i2v (HD tier) | `xai/grok-imagine-video v1.5 i2v` on fal, 2.5s per shot | `minimax/h3-max-turbo i2v` | seconds | $0.01/s / $0.025/s | 15 × $0.01 = $0.15 / 15 × $0.025 = $0.375 |
| 5. Narration TTS | Kokoro (in-browser, open-source) OR `openai/gpt-audio-mini` on OpenRouter | `openai/gpt-audio` | ~400 chars | $0 / ~$0.003 | $0 / $0.003 |
| 6. Music | CC0 library (bundled) | `google/lyria-3-clip-preview` (15s clip) | 1 clip | $0 / ~$0.01 | $0 / $0.01 |
| 7. Captions | SRT from shot list (deterministic, no model) | — | — | $0 | $0 |
| 8. Compose | In-browser `MediaRecorder` (existing) OR Worker-side ffmpeg-wasm | — | — | $0 | $0 |

**Why fal, not OpenRouter, for video:** OpenRouter has no `/videos` endpoint as of 2026-11-05. fal is the only aggregator with grok-imagine-video at $0.01/s, which is the price that makes motion viable.

**Why Gemini image for identity:** multi-image `image_input` with the character sheet + per-shot prompt is the cheapest path to consistent-looking character across 6 shots without training anything on the kid.

---

## 3. Cost per character and per 15s reel

### Per-reel math

**Cheapest working path (stills, in-browser TTS, CC0 music):**

```
shot list:        $0.0002
6 keyframes:      $0.234    (gemini-2.5-flash-image @ $0.039/img)
motion:           $0
narration:        $0        (Kokoro in-browser)
music:            $0
compose:          $0
                  -------
Total:            $0.234 per 15s reel
```

**Better quality (3.1 flash keyframes, grok motion, gpt-audio-mini narration, Lyria music):**

```
shot list:        $0.0002
6 keyframes:      $0.462    (gemini-3.1-flash-image @ $0.077/img)
motion 15s:       $0.150    (grok-imagine-video @ $0.01/s)
narration:        $0.003
music:            $0.010
compose:          $0
                  -------
Total:            $0.625 per 15s reel
```

**Premium (3-pro keyframes, minimax motion):** ~$1.30/reel. Not recommended for v1.

### Per-character math

A reel's story is ~450 chars. So:
- Cheapest: **$0.234 / 450 = $0.00052 per character** (~$0.52 per 1000 chars of story input)
- Better:   **$0.625 / 450 = $0.00139 per character** (~$1.39 per 1000 chars)

Character sheet amortization: $0.039 one-time per child, spread over N reels. After 10 reels that's +$0.004/reel. Negligible.

### Free-tier path (Cloudflare Workers AI, $0)

```
shot list:        Llama-3.1-8b on WAI       ($0, within 10k neurons/day)
6 keyframes:      flux-1-schnell on WAI     ($0, ~40 img/day budget = 6-7 reels/day/account)
narration:        Kokoro in-browser         ($0)
music:            CC0                        ($0)
Total:            $0 — capped at ~6 reels/day globally on free tier
```

Identity consistency is **worse** on flux-schnell (no multi-ref). Acceptable for "try before you buy"; paid tier gets Gemini.

---

## 4. Architecture

```
┌─────────────────────────────┐
│  GitHub Pages (static SPA)  │  ← existing Vite bundle, no keys
│  IndexedDB (local cache)    │
└────────────┬────────────────┘
             │ fetch (OTP cookie)
             ▼
┌─────────────────────────────┐
│  api.<domain> — CF Worker   │  ← all AI calls originate here
│  ─ auth (Access + OTP)      │
│  ─ budget ledger (D1)       │
│  ─ rate limit (Durable Obj) │
│  ─ enqueue → Queue          │
└────┬────────┬───────────────┘
     │        │
     │        ▼
     │   ┌──────────────────┐
     │   │  CF Queue        │
     │   │  (video jobs)    │
     │   └────────┬─────────┘
     │            ▼
     │   ┌──────────────────┐
     │   │ Worker consumer  │ ─► OpenRouter (image, text, tts)
     │   │ (long jobs)      │ ─► fal.ai   (i2v)
     │   │                  │ ─► Workers AI (free tier)
     │   └────────┬─────────┘
     ▼            ▼
┌──────────┐  ┌──────────────┐
│   D1     │  │     R2       │
│ users,   │  │ character    │
│ kids,    │  │  sheets,     │
│ reels,   │  │ keyframes,   │
│ jobs,    │  │ reels mp4    │
│ ledger   │  │ (signed URL, │
└──────────┘  │  1h TTL)     │
              └──────────────┘
```

**Key rules:**

- **Keys never in browser.** OpenRouter + fal keys live only in Worker secrets (`wrangler secret put`). Browser calls `POST /api/reels/generate` and gets a job ID.
- **Auth:** Cloudflare Access with one-time-code email login. Parent is the account; kids are rows in `profiles` table under parent. Session = signed cookie, 30-day sliding.
- **Rate limits:** Durable Object per user. Default: 10 reels/hour, 30/day. Global DO: 200 reels/hour across all users (kill-switch).
- **Budget caps:** D1 `ledger` table, one row per API call with cost. Worker checks sum-over-window before each call. Returns 402 if user-day > $0.50 (free) / $5 (paid), or global-day > $20. Priyansh gets email at 80% of global cap.
- **Job queue:** reel generation is 10-40s wall time. Browser `POST /api/reels` → returns `{job_id}`. Worker enqueues, returns immediately. Browser polls `GET /api/jobs/:id` (or subscribes via SSE). Keyframes stream back as they finish.
- **Storage:** R2 bucket `reels-media`. Prefix by `user_id/kid_id/`. Reels served via signed URLs, 1-hour TTL. No public bucket, no listing.
- **Signed URLs:** generated per request by Worker, never cached in D1. Parent can share by generating a 7-day family-share URL that requires the share token in path.
- **No telemetry to third parties.** All logs to Cloudflare Logpush → R2, 30-day retention.

---

## 5. Identity consistency approach

The hard problem: the same kid looks like the same kid across 6 keyframes, without fine-tuning on their photo.

**Approach (cheap, no training):**

1. **One-time character sheet.** When parent uploads kid's photo:
   - Worker calls Gemini image with prompt: *"Create a stylised children's-book character reference sheet of this child: 3 poses (front, 3/4, side), 2 expressions (smile, surprised). Soft watercolor, no photorealism."*
   - Output = one ~1024×1024 PNG stored in R2 as the character sheet.
   - **Source photo deleted within 60s.** (§6)
2. **Per-shot generation.** For each of 6 shots:
   - Call Gemini image with `image_input = [character_sheet, optional_scene_ref]` and prompt *"[character] [doing thing] in [scene], same character sheet reference, watercolor storybook style"*.
   - Gemini's multi-reference preserves face/hair/clothes well enough for same-child recognition across shots.
3. **Fallback if drift detected.** Lightweight check: compare CLIP embedding of each shot against character sheet (Workers AI has `@cf/openai/clip`). If cosine < 0.75, regenerate once with stronger prompt weighting.
4. **No LoRA, no DreamBooth, no fine-tuning.** Zero training artifacts means zero model-weights-containing-kid problem.
5. **Co-star consistency:** parents can create up to 3 character sheets (kid + 2 others). Same pipeline, each gets its own sheet.

Known limit: Gemini multi-ref is good, not perfect. Side-profile shots drift more than front. Shot list generator is instructed to prefer front/3-quarter angles.

---

## 6. Kids-photo privacy

This is the section that has to be bulletproof.

### Consent flow

- **Parent gate** at upload (existing). Add: explicit checkbox *"I am this child's parent or legal guardian"* with name typed in.
- **Second checkbox** for any additional person in the photo: *"I have the consent of every other person in this photo to use their likeness."* If unchecked, we won't process photos with >1 face (face count via Workers AI `@cf/microsoft/resnet-50` or similar).
- **No social login.** We don't want Facebook/Google linking kid identities to profiles.
- **Age gate:** account holder must confirm 18+. Kids never log in; parent manages everything.

### Data lifecycle

1. Photo uploaded → Worker stores in R2 at `tmp/<uuid>` with 60s TTL enforced by scheduled Worker.
2. Character sheet generated from photo.
3. **Photo deleted from R2 within 60s** (hard enforced by scheduled Worker running every minute + delete call immediately after sheet generation, whichever fires first).
4. Only the stylised sheet persists. The sheet is non-photoreal by prompt design.
5. Sheet can be deleted by parent at any time via settings → cascades to delete all reels using it.
6. **"Forget this child" button** = hard-delete all rows + R2 objects for that `kid_id`, confirmed within 24h (not 30-day soft-delete).

### Provider rules

- **OpenRouter:** we send images only via providers with no-training-on-input policies. Gemini image models via OpenRouter → Google's "zero data retention" tier. Verify in OpenRouter provider settings; if a provider doesn't honor ZDR, blocklist it in the Worker's allowed-model list.
- **fal.ai:** video i2v runs on a stylised keyframe (not a photo). So even if fal retains, it retains the storybook image, not the kid's face.
- **Cloudflare Workers AI:** inputs not used for training per their terms.
- **Explicit blocklist:** no model gets a raw uploaded photo except the character-sheet generator call, once, within 60s.

### URLs & sharing

- No public URLs ever. All media is signed-URL only, 1h TTL for in-app, 7d for explicit family share with revocation.
- Instagram draft queue (existing) requires parent to tap "export to IG" per reel; we don't auto-publish anywhere.
- Shared reels use the stylised avatar, not the source photo (which is already deleted).

### COPPA-style posture

- No collection of personal data *from* the child. Parent-provided only.
- No behavioral advertising, no analytics tied to child profiles.
- Data access/deletion request = one email, 24h SLA, documented in `/privacy` page.
- We're not formally COPPA-certified until legal review, but the data model is built so compliance is additive, not a rewrite.

---

## 7. Milestones

**M0 — Infra up, $0 spent (week 1)**
- Priyansh creates Cloudflare account + API token (§8 item 1).
- `wrangler` scaffolds Worker, D1, R2, Queue from shell.
- Auth (OTP), budget ledger, rate limit DO deployed.
- Static SPA on Pages talks to Worker via `api.<domain>`.
- **Demo:** login, create kid profile, see empty reel feed.

**M1 — Free-tier generation (week 2)**
- Workers AI pipeline: Llama shot list + flux-schnell keyframes + Kokoro TTS (in-browser) + CC0 music + in-browser compose.
- Character sheet generation (even on free tier, via flux with photo hint — lower consistency acceptable here as proof).
- Photo deletion job verified.
- **Demo:** first end-to-end reel, $0 spent.

**M2 — Paid tier, OpenRouter + Gemini (week 3)**
- Priyansh funds OpenRouter $10 (§8 item 2).
- Paid path: Gemini 2.5-flash-image keyframes with multi-ref character sheet.
- Budget caps enforced; 402 on overage.
- **Demo:** side-by-side free vs paid reel, identity consistency visible.

**M3 — Motion tier via fal (week 4)**
- Priyansh funds fal $10 (§8 item 3).
- grok-imagine-video i2v for HD reels.
- Queue consumer handles 30-40s jobs, SSE progress to browser.
- **Demo:** HD reel with motion, cost per reel logged.

**M4 — Paywall, sharing, polish (week 5-6)**
- Stripe (or similar) for paid tier upgrade. Priyansh signs up (§8 item 4).
- Family share URLs, IG draft export (existing UI wired to real reels).
- Privacy page, data export/delete flows.
- **Ship v1 public.**

**M5+ — later**
- Fine-tuned shot-list prompts per genre.
- Multi-language narration (gpt-audio voices).
- Native iOS wrapper.

---

## 8. Exact keys & accounts Priyansh must provide

For each: what it is, how to get it, what we do with it, why it's needed.

1. **Cloudflare API token** (M0, free)
   - Create at: dash.cloudflare.com → My Profile → API Tokens → Create Token → *Custom token*.
   - Scopes: `Account:Workers Scripts:Edit`, `Account:D1:Edit`, `Account:R2:Edit`, `Account:Queues:Edit`, `Account:Workers AI:Read`, `Zone:DNS:Edit` (only for the one zone used for `api.<domain>`).
   - Paste into shell as `CLOUDFLARE_API_TOKEN=…`. `wrangler` picks it up.
   - **Why:** this is the entire backend. Without it, nothing deploys.

2. **OpenRouter API key + $10 prepay** (M2, first paid)
   - Create at: openrouter.ai → Keys → Create Key. Fund wallet $10 at openrouter.ai/credits.
   - `wrangler secret put OPENROUTER_API_KEY` in the shell.
   - **Why:** Gemini image models (identity consistency), optional gpt-audio TTS, cheap text models.
   - **Why OpenRouter not direct Google/OpenAI:** single key, single bill, swap models without changing code, no separate Google Cloud signup.
   - $10 = ~40 paid reels or ~250 free-tier-with-paid-fallback reels. Enough for development + demo.

3. **fal.ai API key + $10 prepay** (M3, motion tier only)
   - Create at: fal.ai → Dashboard → API Keys. Fund $10 at fal.ai/dashboard/billing.
   - `wrangler secret put FAL_API_KEY`.
   - **Why:** only reasonable source of $0.01/s i2v (grok-imagine). OpenRouter has no video endpoint.
   - **Why not Replicate/Runway:** fal has grok at the cheapest listed price; Runway/Pika are 5-20× more.
   - Skip this entire step if we decide motion tier isn't in v1.

4. **Stripe account + restricted key** (M4, paywall)
   - Signup at stripe.com (he can do in browser with Google). Create restricted key with `write` on `subscriptions`, `customers`, `prices`, `products`, `checkout_sessions`.
   - `wrangler secret put STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.
   - **Why:** collect money. Deferrable to M4; skip until needed.

5. **Domain** (M0, one-time)
   - Any domain, registered anywhere. Priyansh gives us the name; we point nameservers at Cloudflare (CLI-guided).
   - **Why:** need a custom origin for `api.<domain>`. Can defer by using `*.workers.dev` subdomain for M0-M3; only strictly needed for M4 launch.

6. **Email-send provider** (M0, free tier)
   - Resend (3k emails/mo free) or Cloudflare Email Routing Worker. Recommend Resend: signup at resend.com, API key.
   - `wrangler secret put RESEND_API_KEY`.
   - **Why:** OTP login emails. Free tier is enough for development.

What Priyansh does **not** need to provide: Supabase, Firebase, Google Cloud, OpenAI direct, Anthropic direct, Replicate, Runway. Deliberately avoided.

---

## 9. Risks & open questions

**Risks**

- **Identity drift on Gemini multi-ref.** Not perfectly consistent; some shots will look off-model. Mitigation: CLIP similarity check + one regen retry (§5). Open: if that's not enough, do we accept the drift or move to a training-based approach (which conflicts with §6)?
- **fal pricing volatility.** $0.01/s grok is an introductory price. If it jumps to $0.03/s, cheapest-motion reel goes from $0.15 → $0.45. Mitigation: motion tier is paid-only, so cost passes through.
- **Cloudflare Workers AI daily cap.** 10k neurons/day is global per account, not per user. 100 free users all trying at once will exhaust it. Mitigation: per-user daily free cap (3 reels/day/user), queue overflow with "try again tomorrow".
- **R2 abuse via family-share URLs.** A reel that goes viral externally could rack up R2 operations costs (egress is free, but Class A ops aren't). Mitigation: signed URL + short TTL + per-share-token rate limit on Worker.
- **In-browser compose is Chrome-biased.** `MediaRecorder` + canvas is already shipped and works, but Safari has quirks. Not a new risk vs today, but worth noting if we move to Worker-side ffmpeg later.
- **COPPA compliance is self-assessed, not certified.** If we grow, we need actual legal review before marketing to under-13 users.
- **Model deprecation.** OpenRouter model names change. Pin via version strings; monitor via a weekly cron that lists available models and alerts on diff.

**Open questions for Priyansh**

1. Budget caps in §0 item 7 — are $0.50/$5/$20 the right numbers?
2. Do we build motion tier (M3) in v1, or ship stills-only and add motion in v2?
3. Domain — do you have one, or should we start on `*.workers.dev`?
4. Paywall timing — M4 or push to v2?
5. Confirm the privacy posture in §6 is the bar you want, or go stricter (e.g. photo never leaves browser, use on-device-only character sheet generation via web diffusion models — slower, more complex, more private).
6. Who's the first user we test with — your family, or external beta list? Affects how much polish M1-M3 need.
7. Instagram export in v1 or later? The draft queue exists; publishing needs IG Graph API + business account.

---

*End of plan. No code was written. Awaiting signoff on §0 flagged items and §9 open questions before starting M0.*

---
## 10. Corrections by Grok Bot (override the sections above where they conflict)
- **"Cost per character" means per AI character, not per text character.** One character = a photo-to-sheet call (1 ref image in + turnaround sheet out) plus ~2 retries/variants: cheapest **~$0.04-0.12** (gemini-2.5-flash-image / 3.1-flash-lite-image, ~$0.039/image), better **~$0.23-0.46** (gemini-3.1-flash-image $0.077 or 3-pro-image $0.155/image, 1-3 images). Free option: Workers AI flux-schnell from a text description, no photo, weak identity.
- **Per 15 s reel:** $0 (free tier, stills, Kokoro, CC0, in-browser compose; ~6 reels/day account-wide) / **~$0.24 cheapest AI stills** / **~$0.63 better (3.1-flash keyframes + grok-imagine i2v $0.01/s)** / ~$1.30 premium (minimax h3-max-turbo or Wan 3 480p motion).
- **Auth: drop Cloudflare Access and Resend for v1.** Use a Worker-issued session: parent signs in with Google (Firebase Auth free tier or Google Identity Services; Google sites work in the box browser) or a magic link later. Until then, an invite-code allowlist (only Priyansh's family) is enough and needs no extra account.
- **Domain: not needed.** Use `<name>.workers.dev` for the API; Pages stays at github.io. Remove the Zone:DNS scope from the token.
- **Budget caps (for him to confirm):** OpenRouter key with its own credit limit set in the OpenRouter dashboard (e.g. $5), fal prepaid $5-10 only (no auto top-up), Worker ledger: 5 characters + 10 reels/user/day, $2/day global kill switch.
- **Privacy add:** turn on OpenRouter "Zero data retention" / disallow prompt-logging providers in account privacy settings and pin `provider.data_collection: "deny"` in every request; source photo goes to R2 private bucket only, deleted right after the sheet call; no photo is ever sent to fal.
- **Stripe / paywall stays mocked** until he asks; not needed for e2e.
