// src/node-server.ts
import { createServer } from "node:http";

// src/env-node.ts
import { createClient as createClient3 } from "@libsql/client";

// src/storage/d1-libsql.ts
import { createClient } from "@libsql/client";
function toInArgs(args) {
  return args.map((a) => {
    if (a === null || a === void 0) return null;
    if (typeof a === "boolean") return a ? 1 : 0;
    if (a instanceof Uint8Array) return a;
    if (typeof a === "number" || typeof a === "bigint" || typeof a === "string") return a;
    return String(a);
  });
}
function rowToObject(columns, row) {
  const out = {};
  for (let i = 0; i < columns.length; i++) {
    const v = row[i];
    out[columns[i]] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}
var LibsqlStatement = class {
  constructor(client, sql) {
    this.client = client;
    this.sql = sql;
  }
  args = [];
  bind(...values) {
    this.args = toInArgs(values);
    return this;
  }
  async first() {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    const row = rs.rows[0];
    return row ? rowToObject(rs.columns, row) : null;
  }
  async all() {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    const results = rs.rows.map(
      (row) => rowToObject(rs.columns, row)
    );
    return { results, success: true, meta: { changes: Number(rs.rowsAffected) } };
  }
  async run() {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return {
      success: true,
      meta: {
        changes: Number(rs.rowsAffected),
        last_row_id: rs.lastInsertRowid !== void 0 ? Number(rs.lastInsertRowid) : void 0
      }
    };
  }
  // Internal accessor for batch().
  _payload() {
    return { sql: this.sql, args: this.args };
  }
};
var LibsqlDb = class {
  constructor(client) {
    this.client = client;
  }
  prepare(sql) {
    return new LibsqlStatement(this.client, sql);
  }
  async batch(statements) {
    const payloads = statements.map((s) => s._payload());
    const results = await this.client.batch(payloads, "deferred");
    return results.map((rs) => ({
      success: true,
      meta: { changes: Number(rs.rowsAffected) }
    }));
  }
};

// src/storage/r2-libsql.ts
import { createClient as createClient2 } from "@libsql/client";
async function etagFor(bytes) {
  const buf = bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}
function toBytes(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}
var LibsqlR2Body = class {
  constructor(bytes, meta) {
    this.bytes = bytes;
    this.meta = meta;
  }
  get httpMetadata() {
    return { contentType: this.meta.contentType };
  }
  get customMetadata() {
    return this.meta.customMetadata;
  }
  get httpEtag() {
    return this.meta.etag;
  }
  get body() {
    const bytes = this.bytes;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });
  }
  writeHttpMetadata(headers) {
    if (this.meta.contentType) headers.set("Content-Type", this.meta.contentType);
  }
  async arrayBuffer() {
    return this.bytes.slice().buffer;
  }
  async text() {
    return new TextDecoder().decode(this.bytes);
  }
  async json() {
    return JSON.parse(await this.text());
  }
};
var LibsqlR2 = class {
  constructor(client) {
    this.client = client;
  }
  async put(key, value, options) {
    const bytes = toBytes(value);
    const now = Date.now();
    const customMeta = options?.customMetadata ? JSON.stringify(options.customMetadata) : null;
    await this.client.execute({
      sql: `INSERT INTO blobs (key, content, content_type, uploaded_at, custom_meta)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              content = excluded.content,
              content_type = excluded.content_type,
              uploaded_at = excluded.uploaded_at,
              custom_meta = excluded.custom_meta`,
      args: [key, bytes, options?.httpMetadata?.contentType ?? null, now, customMeta]
    });
  }
  async get(key) {
    const rs = await this.client.execute({
      sql: "SELECT content, content_type, custom_meta FROM blobs WHERE key = ?",
      args: [key]
    });
    const row = rs.rows[0];
    if (!row) return null;
    const content = row[0];
    const contentType = row[1] ?? void 0;
    const rawMeta = row[2] ?? null;
    const bytes = content instanceof Uint8Array ? content : content instanceof ArrayBuffer ? new Uint8Array(content) : new Uint8Array(0);
    const customMetadata = rawMeta ? JSON.parse(rawMeta) : void 0;
    const etag = await etagFor(bytes);
    return new LibsqlR2Body(bytes, { contentType, customMetadata, etag });
  }
  async delete(keys2) {
    const list3 = Array.isArray(keys2) ? keys2 : [keys2];
    if (list3.length === 0) return;
    const placeholders = list3.map(() => "?").join(",");
    await this.client.execute({
      sql: `DELETE FROM blobs WHERE key IN (${placeholders})`,
      args: list3
    });
  }
  async list(options) {
    const prefix = options?.prefix ?? "";
    const rs = await this.client.execute({
      sql: "SELECT key, custom_meta FROM blobs WHERE key LIKE ? ORDER BY key",
      args: [`${prefix}%`]
    });
    const objects = rs.rows.map((row) => {
      const key = String(row[0]);
      const rawMeta = row[1] ?? null;
      const customMetadata = rawMeta ? JSON.parse(rawMeta) : void 0;
      return { key, ...customMetadata ? { customMetadata } : {} };
    });
    return { objects, truncated: false };
  }
};

// src/config/limits.ts
var PROVIDER_CAP_USD = {
  openrouter: 10,
  fal: 10
};
var DAILY_LIMITS = {
  chars: 5,
  reels: 10
};
var INVITE_LIMITS = { perHour: 20 };
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var TMP_MAX_AGE_MS = 6e4;
var MAX_PHOTO_BYTES = 8 * 1024 * 1024;
var PHOTO_MIME_ALLOWLIST = ["image/jpeg", "image/png", "image/webp"];
function capFor(provider) {
  return provider in PROVIDER_CAP_USD ? PROVIDER_CAP_USD[provider] : void 0;
}

// src/config/flags.ts
function isOn(value, fallback) {
  if (value === void 0) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}
function readFlags(env2) {
  return {
    openrouter: isOn(env2.ENABLE_OPENROUTER, false),
    fal: isOn(env2.ENABLE_FAL, false),
    killSwitchEnv: isOn(env2.KILL_SWITCH, false),
    mockProviders: isOn(env2.MOCK_PROVIDERS, false)
  };
}

// src/budget/kill_switch.ts
async function isKilled(env2) {
  if (isOn(env2.KILL_SWITCH, false)) return true;
  const row = await env2.DB.prepare("SELECT enabled FROM kill_switch WHERE id = 1").first();
  return row?.enabled === 1;
}
async function setKillSwitch(env2, enabled, reason, now = Date.now()) {
  await env2.DB.prepare(
    `INSERT INTO kill_switch (id, enabled, reason, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, reason = excluded.reason, updated_at = excluded.updated_at`
  ).bind(enabled ? 1 : 0, reason ?? null, now).run();
}

// src/util/errors.ts
var ApiError = class extends Error {
  status;
  code;
  details;
  constructor(status, code, message, details) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var Unauthorized = class extends ApiError {
  constructor(message = "unauthorized") {
    super(401, "unauthorized", message);
    this.name = "Unauthorized";
  }
};
var Forbidden = class extends ApiError {
  constructor(code = "forbidden", message = code) {
    super(403, code, message);
    this.name = "Forbidden";
  }
};
var BadRequest = class extends ApiError {
  constructor(message = "bad_request") {
    super(400, "bad_request", message);
    this.name = "BadRequest";
  }
};
var NotFound = class extends ApiError {
  constructor(message = "not_found") {
    super(404, "not_found", message);
    this.name = "NotFound";
  }
};
var BudgetExceeded = class extends ApiError {
  provider;
  remainingUsd;
  constructor(provider, remainingUsd) {
    super(402, "budget_exceeded", "budget_exceeded", { provider, remaining_usd: remainingUsd });
    this.name = "BudgetExceeded";
    this.provider = provider;
    this.remainingUsd = remainingUsd;
  }
};
var KillSwitchOn = class extends ApiError {
  constructor() {
    super(402, "kill_switch", "kill_switch");
    this.name = "KillSwitchOn";
  }
};
var ProviderDisabled = class extends ApiError {
  constructor(provider) {
    super(503, "provider_disabled", "provider_disabled", { provider });
    this.name = "ProviderDisabled";
  }
};
var RateLimited = class extends ApiError {
  scope;
  constructor(scope) {
    super(429, "rate_limited", "rate_limited", { scope });
    this.name = "RateLimited";
    this.scope = scope;
  }
};
function errorResponse(err) {
  if (err instanceof ApiError) {
    return Response.json({ error: err.code, ...err.details ?? {} }, { status: err.status });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}

// src/util/uuid.ts
function uuid() {
  return crypto.randomUUID();
}

// src/budget/ledger.ts
var SELECT_LEDGER = "SELECT est_usd, provider FROM ledger WHERE id = ?";
async function currentSpend(db, provider) {
  const row = await db.prepare("SELECT total_usd FROM budget_state WHERE provider = ?").bind(provider).first();
  return row?.total_usd ?? 0;
}
async function guardSpend(args) {
  const { provider, estUsd } = args;
  const db = args.env.DB;
  const now = args.now ?? Date.now();
  const cap = capFor(provider);
  if (cap === void 0) throw new Error(`unknown_paid_provider:${provider}`);
  if (await isKilled(args.env)) throw new KillSwitchOn();
  await db.prepare(
    "INSERT INTO budget_state (provider, total_usd, updated_at) VALUES (?, 0, ?) ON CONFLICT(provider) DO NOTHING"
  ).bind(provider, now).run();
  const charge = await db.prepare(
    "UPDATE budget_state SET total_usd = total_usd + ?, updated_at = ? WHERE provider = ? AND total_usd + ? <= ?"
  ).bind(estUsd, now, provider, estUsd, cap).run();
  if ((charge.meta.changes ?? 0) !== 1) {
    const spent = await currentSpend(db, provider);
    throw new BudgetExceeded(provider, Math.max(0, round6(cap - spent)));
  }
  const ledgerId = uuid();
  try {
    await db.prepare(
      "INSERT INTO ledger (id, user_id, provider, model, step, est_usd, actual_usd, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)"
    ).bind(ledgerId, args.userId ?? null, provider, args.model, args.step, estUsd, now).run();
  } catch (err) {
    await db.prepare(
      "UPDATE budget_state SET total_usd = MAX(0, total_usd - ?), updated_at = ? WHERE provider = ?"
    ).bind(estUsd, now, provider).run();
    throw err;
  }
  return ledgerId;
}
async function assertHeadroom(db, provider, estUsd) {
  const cap = capFor(provider);
  if (cap === void 0) throw new Error(`unknown_paid_provider:${provider}`);
  const spent = await currentSpend(db, provider);
  if (spent + estUsd > cap) throw new BudgetExceeded(provider, Math.max(0, round6(cap - spent)));
}
async function reconcileSpend(db, ledgerId, actualUsd, requestId, now = Date.now()) {
  const row = await db.prepare(SELECT_LEDGER).bind(ledgerId).first();
  if (!row) throw new Error("ledger_not_found");
  await db.batch([
    db.prepare(
      "UPDATE budget_state SET total_usd = MAX(0, total_usd + ?), updated_at = ? WHERE provider = ?"
    ).bind(round6(actualUsd - row.est_usd), now, row.provider),
    db.prepare("UPDATE ledger SET actual_usd = ?, request_id = ? WHERE id = ?").bind(actualUsd, requestId ?? null, ledgerId)
  ]);
}
async function compensateSpend(db, ledgerId, now = Date.now()) {
  const row = await db.prepare(SELECT_LEDGER).bind(ledgerId).first();
  if (!row) return;
  await db.batch([
    db.prepare(
      "UPDATE budget_state SET total_usd = MAX(0, total_usd - ?), updated_at = ? WHERE provider = ?"
    ).bind(row.est_usd, now, row.provider),
    db.prepare("DELETE FROM ledger WHERE id = ?").bind(ledgerId)
  ]);
}
function round6(usd) {
  return Math.round(usd * 1e6) / 1e6;
}

// src/config/costs.ts
var COSTS = {
  shot_list: { provider: "openrouter", model: "google/gemini-2.5-flash", usd: 2e-4 },
  shot_list_free: { provider: "mock", model: "mock-text", usd: 0 },
  character_sheet: { provider: "openrouter", model: "google/gemini-2.5-flash-image", usd: 0.039 },
  keyframe_paid: { provider: "openrouter", model: "google/gemini-2.5-flash-image", usd: 0.039 },
  keyframe_free: { provider: "mock", model: "mock-image", usd: 0 },
  motion_i2v: { provider: "fal", model: "fal-ai/wan-2.1/image-to-video", usdPerSecond: 0.01 },
  tts: { provider: "none", model: "kokoro-in-browser", usd: 0 },
  music: { provider: "none", model: "cc0-bundled", usd: 0 },
  compose: { provider: "none", model: "browser-mediarecorder", usd: 0 }
};
var SHOT_COUNT = 6;
var SHOT_SECONDS = 2.5;
function prechargeUsd(tier) {
  if (tier === "free") return 0;
  const paid = COSTS.shot_list.usd + SHOT_COUNT * COSTS.keyframe_paid.usd;
  if (tier === "paid") return round(paid);
  return round(paid + SHOT_COUNT * SHOT_SECONDS * COSTS.motion_i2v.usdPerSecond);
}
function motionUsd(seconds) {
  return round(seconds * COSTS.motion_i2v.usdPerSecond);
}
function round(usd) {
  return Math.round(usd * 1e6) / 1e6;
}

// src/config/models.ts
var MODELS = {
  openrouterText: "google/gemini-2.5-flash",
  openrouterImage: "google/gemini-2.5-flash-image",
  freeImage: "mock-image",
  freeText: "mock-text",
  falI2V: "fal-ai/wan-2.1/image-to-video"
};

// src/util/hash.ts
var enc = new TextEncoder();
function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function toBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
async function hmac(secret, message) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// src/storage/signed.ts
var MEDIA_TTL_SEC = 3600;
var DEFAULT_PUBLIC_API_BASE = "https://storybook-ai.workers.dev";
function publicBase(env2) {
  return env2.PUBLIC_API_BASE ?? DEFAULT_PUBLIC_API_BASE;
}
function mediaUrl(env2, key, now = Date.now()) {
  return signedMediaUrl(env2.WORKER_SESSION_SECRET, publicBase(env2), key, MEDIA_TTL_SEC, now);
}
async function mediaSignature(secret, key, exp) {
  return hmac(secret, `${key}:${exp}`);
}
async function signMediaPath(secret, key, ttlSec = MEDIA_TTL_SEC, now = Date.now()) {
  const exp = Math.floor(now / 1e3) + ttlSec;
  const sig = toBase64Url(await mediaSignature(secret, key, exp));
  return { path: `/api/media/${key}?exp=${exp}&sig=${sig}`, exp };
}
async function signedMediaUrl(secret, base, key, ttlSec = MEDIA_TTL_SEC, now = Date.now()) {
  const { path } = await signMediaPath(secret, key, ttlSec, now);
  return base.replace(/\/+$/, "") + path;
}
async function verifyMediaSignature(secret, key, exp, sig, now = Date.now()) {
  if (!Number.isFinite(exp) || exp * 1e3 <= now) return false;
  let provided;
  try {
    provided = fromBase64Url(sig);
  } catch {
    return false;
  }
  return timingSafeEqual(await mediaSignature(secret, key, exp), provided);
}

// src/providers/fal.ts
var QUEUE_BASE = `https://queue.fal.run/${MODELS.falI2V}`;
function assertSafeVideoInput(key) {
  if (!(key.startsWith("sheets/") || key.startsWith("reels/"))) {
    throw new Error(`fal_unsafe_input_key:${key.split("/")[0] ?? "empty"}`);
  }
}
function makeFalVideo(apiKey, signImageUrl, fetchImpl = fetch) {
  const auth = { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" };
  return {
    id: "fal-wan-2.1-i2v",
    estUsd: (opts) => motionUsd(opts.seconds),
    async i2v(opts) {
      assertSafeVideoInput(opts.imageKey);
      const imageUrl = await signImageUrl(opts.imageKey);
      if (!imageUrl.startsWith("https://")) throw new Error("fal_unsigned_image_url");
      const submit = await fetchImpl(QUEUE_BASE, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: opts.prompt ?? "",
          duration: String(opts.seconds)
        })
      });
      if (!submit.ok) throw new Error(`fal_submit_http_${submit.status}`);
      const { request_id } = await submit.json();
      const statusUrl = `${QUEUE_BASE}/requests/${request_id}/status`;
      const deadline = Date.now() + 10 * 6e4;
      for (; ; ) {
        const res = await fetchImpl(statusUrl, { headers: auth });
        if (!res.ok) throw new Error(`fal_status_http_${res.status}`);
        const status = await res.json();
        if (status.status === "COMPLETED") {
          const resultUrl = status.response_url ?? `${QUEUE_BASE}/requests/${request_id}`;
          const out = await fetchImpl(resultUrl, { headers: auth });
          if (!out.ok) throw new Error(`fal_result_http_${out.status}`);
          const result = await out.json();
          if (!result.video?.url) throw new Error("fal_no_video");
          const video = await fetchImpl(result.video.url);
          if (!video.ok) throw new Error(`fal_download_http_${video.status}`);
          return {
            value: { bytes: new Uint8Array(await video.arrayBuffer()), seconds: opts.seconds },
            actualUsd: COSTS.motion_i2v.usdPerSecond * opts.seconds,
            requestId: request_id
          };
        }
        if (status.status === "FAILED") throw new Error("fal_job_failed");
        if (Date.now() > deadline) throw new Error("fal_timeout");
        await new Promise((r) => setTimeout(r, 2e3));
      }
    }
  };
}

// src/providers/mock.ts
async function fixtureBytes(label) {
  const digest = await sha256Hex(label);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(digest.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
function makeMockImage() {
  return {
    id: "mock-image",
    estUsd: () => 0,
    async generate(opts) {
      return { value: { bytes: await fixtureBytes(opts.prompt), mime: "image/png" }, actualUsd: 0 };
    }
  };
}
function makeMockText() {
  return {
    id: "mock-text",
    estUsd: () => 0,
    async complete(opts) {
      return {
        value: { text: JSON.stringify({ shots: [], prompt_hash: await sha256Hex(opts.prompt) }) },
        actualUsd: 0
      };
    }
  };
}
function makeMockVideo() {
  return {
    id: "mock-video",
    estUsd: () => 0,
    async i2v(opts) {
      return {
        value: { bytes: await fixtureBytes(opts.imageKey + opts.prompt), seconds: opts.seconds },
        actualUsd: 0
      };
    }
  };
}

// src/providers/openrouter.ts
var ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
var REFERER = "https://lucklypriyansh-2.github.io/storybook-ai-demo";
var PROVIDER_POLICY = {
  data_collection: "deny",
  allow_fallbacks: false,
  require_parameters: true
};
function buildOpenRouterBody(model, messages, modalities) {
  return {
    model,
    messages,
    provider: { ...PROVIDER_POLICY },
    ...modalities ? { modalities } : {}
  };
}
async function call(apiKey, body, fetchImpl) {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": REFERER,
      "X-Title": "storybook-ai-demo"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`openrouter_http_${res.status}`);
  return await res.json();
}
function imageFromResponse(resp) {
  const url = resp.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("openrouter_no_image");
  const comma = url.indexOf(",");
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function makeOpenRouterImage(apiKey, fetchImpl = fetch) {
  return {
    id: "openrouter-gemini-2.5-flash-image",
    estUsd: () => COSTS.character_sheet.usd,
    async generate(opts) {
      const content = [{ type: "text", text: opts.prompt }];
      if (opts.image) {
        const url = "url" in opts.image ? opts.image.url : `data:${opts.image.mime};base64,${bytesToBase64(opts.image.data)}`;
        content.push({ type: "image_url", image_url: { url } });
      }
      const resp = await call(
        apiKey,
        buildOpenRouterBody(MODELS.openrouterImage, [{ role: "user", content }], ["image", "text"]),
        fetchImpl
      );
      return {
        value: { bytes: imageFromResponse(resp), mime: "image/png" },
        actualUsd: COSTS.character_sheet.usd,
        requestId: resp.id
      };
    }
  };
}
function makeOpenRouterText(apiKey, fetchImpl = fetch) {
  return {
    id: "openrouter-gemini-2.5-flash",
    estUsd: () => COSTS.shot_list.usd,
    async complete(opts) {
      const messages = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });
      messages.push({ role: "user", content: opts.prompt });
      const resp = await call(
        apiKey,
        buildOpenRouterBody(MODELS.openrouterText, messages),
        fetchImpl
      );
      return {
        value: { text: resp.choices?.[0]?.message?.content ?? "" },
        actualUsd: COSTS.shot_list.usd,
        requestId: resp.id
      };
    }
  };
}

// src/providers/index.ts
function pickFreeImage(_env) {
  return makeMockImage();
}
function livePaid(env2, provider) {
  const flags = readFlags(env2);
  if (flags.mockProviders) return false;
  return provider === "openrouter" ? flags.openrouter && !!env2.OPENROUTER_API_KEY : flags.fal && !!env2.FAL_KEY;
}
function makeProviders(env2) {
  const flags = readFlags(env2);
  const mock = flags.mockProviders;
  let image;
  if (mock) {
    image = makeMockImage();
  } else if (flags.openrouter) {
    image = env2.OPENROUTER_API_KEY ? makeOpenRouterImage(env2.OPENROUTER_API_KEY) : makeMockImage();
  } else {
    image = makeMockImage();
  }
  let text;
  if (mock) {
    text = makeMockText();
  } else if (flags.openrouter && env2.OPENROUTER_API_KEY) {
    text = makeOpenRouterText(env2.OPENROUTER_API_KEY);
  } else {
    text = makeMockText();
  }
  const video = !mock && flags.fal && env2.FAL_KEY ? makeFalVideo(env2.FAL_KEY, (key) => mediaUrl(env2, key)) : makeMockVideo();
  return { image, text, video, mocked: mock };
}
function pickProvider(env2, step, tier = "paid") {
  const flags = readFlags(env2);
  const set = makeProviders(env2);
  if (step === "character_sheet") {
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.image;
  }
  if (step === "keyframe") {
    if (tier === "free") return makeMockImage();
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.image;
  }
  if (step === "shot_list") {
    if (tier === "free") return makeMockText();
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.text;
  }
  if (!flags.mockProviders && !flags.fal) throw new ProviderDisabled("fal");
  return set.video;
}

// src/storage/r2.ts
var keys = {
  tmp: (id) => `tmp/${id}`,
  sheet: (kidId, sheetId) => `sheets/${kidId}/${sheetId}.png`,
  reel: (reelId, file) => `reels/${reelId}/${file}`
};
async function putTmp(r2, id, bytes, contentType, now = Date.now()) {
  const key = keys.tmp(id);
  await r2.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { uploaded_at: String(now) }
  });
  return key;
}
async function deleteObject(r2, key) {
  await r2.delete(key);
}
async function deletePrefix(r2, prefix) {
  let cursor;
  let deleted = 0;
  do {
    const listed = await r2.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await r2.delete(listed.objects.map((o) => o.key));
      deleted += listed.objects.length;
    }
    cursor = listed.truncated ? listed.cursor : void 0;
  } while (cursor);
  return deleted;
}

// src/jobs/state.ts
async function markFailed(env2, jobId, reason) {
  const now = Date.now();
  await env2.DB.batch([
    env2.DB.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(
      reason,
      now,
      jobId
    ),
    env2.DB.prepare(
      "UPDATE reels SET status = 'failed' WHERE id IN (SELECT reel_id FROM jobs WHERE id = ?)"
    ).bind(jobId)
  ]);
}
async function setProgress(env2, jobId, progress) {
  await env2.DB.prepare("UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?").bind(progress, Date.now(), jobId).run();
}

// src/jobs/character_sheet.ts
async function characterSheetJob(env2, jobId) {
  const job = await env2.DB.prepare("SELECT kid_id, photo_id FROM jobs WHERE id = ?").bind(jobId).first();
  if (!job?.kid_id || !job.photo_id) throw new Error("character_sheet_missing_context");
  const kid = await env2.DB.prepare("SELECT user_id FROM kids WHERE id = ?").bind(job.kid_id).first();
  if (!kid) throw new Error("character_sheet_missing_kid");
  const photo = await env2.DB.prepare(
    "SELECT r2_key FROM photos_tmp WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  ).bind(job.photo_id, kid.user_id).first();
  if (!photo) throw new Error("character_sheet_missing_photo");
  await setProgress(env2, jobId, 10);
  if (await isKilled(env2)) throw new KillSwitchOn();
  const paid = livePaid(env2, "openrouter");
  const image = paid ? makeProviders(env2).image : pickFreeImage(env2);
  const model = paid ? MODELS.openrouterImage : MODELS.freeImage;
  const estUsd = paid ? COSTS.character_sheet.usd : 0;
  const ledgerId = paid ? await guardSpend({
    env: env2,
    provider: "openrouter",
    estUsd,
    model,
    step: "character_sheet",
    userId: kid.user_id
  }) : null;
  try {
    const stored = await env2.R2.get(photo.r2_key);
    if (!stored) throw new Error("character_sheet_photo_missing");
    const result = await image.generate({
      prompt: "Character sheet for a children's storybook. Preserve the child's likeness, keep it gentle and consistent.",
      image: {
        data: new Uint8Array(await stored.arrayBuffer()),
        mime: stored.httpMetadata?.contentType ?? "image/jpeg"
      }
    });
    const sheetId = uuid();
    const sheetKey = keys.sheet(job.kid_id, sheetId);
    await env2.R2.put(sheetKey, result.value.bytes, {
      httpMetadata: { contentType: result.value.mime }
    });
    await setProgress(env2, jobId, 90);
    const now = Date.now();
    await env2.DB.batch([
      env2.DB.prepare(
        "INSERT INTO characters (id, kid_id, sheet_r2_key, model, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(sheetId, job.kid_id, sheetKey, model, now),
      env2.DB.prepare("UPDATE photos_tmp SET deleted_at = ? WHERE id = ?").bind(now, job.photo_id),
      env2.DB.prepare("UPDATE jobs SET status = 'done', progress = 100, updated_at = ? WHERE id = ?").bind(now, jobId)
    ]);
    await env2.R2.delete(photo.r2_key);
    if (ledgerId) {
      await reconcileSpend(env2.DB, ledgerId, result.actualUsd ?? estUsd, result.requestId);
    }
    await setProgress(env2, jobId, 100);
  } catch (err) {
    if (ledgerId) await compensateSpend(env2.DB, ledgerId);
    await env2.R2.delete(photo.r2_key);
    await env2.DB.prepare("UPDATE photos_tmp SET deleted_at = ? WHERE id = ?").bind(Date.now(), job.photo_id).run();
    throw err;
  }
}

// src/jobs/motion_i2v.ts
async function motionI2VJob(env2, jobId) {
  if (await isKilled(env2)) throw new KillSwitchOn();
  const row = await env2.DB.prepare(
    "SELECT j.reel_id, j.payload, r.user_id FROM jobs j LEFT JOIN reels r ON r.id = j.reel_id WHERE j.id = ?"
  ).bind(jobId).first();
  if (!row?.reel_id || !row.payload) throw new Error("motion_i2v_missing_context");
  const { shot, keyframe_key } = JSON.parse(row.payload);
  assertSafeVideoInput(keyframe_key);
  await setProgress(env2, jobId, 20);
  const paid = livePaid(env2, "fal");
  const video = pickProvider(env2, "motion_i2v");
  const ledger2 = paid ? await guardSpend({
    env: env2,
    provider: "fal",
    estUsd: motionUsd(SHOT_SECONDS),
    model: MODELS.falI2V,
    step: "motion_i2v",
    userId: row.user_id ?? void 0
  }) : null;
  let bytes;
  try {
    const out = await video.i2v({ imageKey: keyframe_key, seconds: SHOT_SECONDS });
    bytes = out.value.bytes;
    if (ledger2) {
      await reconcileSpend(
        env2.DB,
        ledger2,
        out.actualUsd ?? COSTS.motion_i2v.usdPerSecond * SHOT_SECONDS,
        out.requestId
      );
    }
  } catch (err) {
    if (ledger2) await compensateSpend(env2.DB, ledger2);
    throw err;
  }
  const videoKey = keys.reel(row.reel_id, `shot-${shot}.mp4`);
  await env2.R2.put(videoKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
  await appendShotVideo(env2, row.reel_id, shot, videoKey);
  await setProgress(env2, jobId, 100);
  await env2.DB.prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?").bind(Date.now(), jobId).run();
}
async function appendShotVideo(env2, reelId, shot, videoKey) {
  const manifest = await env2.R2.get(keys.reel(reelId, "shots.json"));
  if (!manifest) return;
  const shots = JSON.parse(await manifest.text());
  const target = shots.find((s) => s.index === shot);
  if (!target) return;
  target.video_key = videoKey;
  await env2.R2.put(keys.reel(reelId, "shots.json"), JSON.stringify(shots), {
    httpMetadata: { contentType: "application/json" }
  });
}

// src/jobs/reel_generate.ts
var KEYFRAME_PROGRESS = [20, 40, 60, 80];
async function reelGenerateJob(env2, jobId) {
  const reelId = await jobReelId(env2, jobId);
  if (!reelId) throw new Error("reel_generate_missing_reel");
  const reel = await env2.DB.prepare(
    "SELECT user_id, kid_id, tier, story FROM reels WHERE id = ?"
  ).bind(reelId).first();
  if (!reel) throw new Error("reel_generate_missing_reel");
  const tier = reel.tier;
  await setProgress(env2, jobId, 5);
  await env2.DB.prepare("UPDATE reels SET status = 'running' WHERE id = ?").bind(reelId).run();
  if (await isKilled(env2)) throw new KillSwitchOn();
  const paidReel = tier !== "free" && livePaid(env2, "openrouter");
  const ledger2 = paidReel ? await guardSpend({
    env: env2,
    provider: "openrouter",
    estUsd: prechargeUsd("paid"),
    model: MODELS.openrouterImage,
    step: "reel_generate",
    userId: reel.user_id
  }) : null;
  let actualUsd = 0;
  let shots = [];
  try {
    const built = await buildShotList(env2, reel, tier);
    shots = built.shots;
    actualUsd += built.actualUsd;
    const image = pickProvider(env2, "keyframe", tier);
    const paidImage = image.id === "openrouter-gemini-2.5-flash-image";
    const sheetKey = paidImage ? await latestSheetKey(env2, reel.kid_id) : null;
    for (let i = 0; i < SHOT_COUNT; i++) {
      const shot = shots[i];
      const ref = sheetKey ? await refFromR2(env2, sheetKey) : void 0;
      const out = await image.generate({
        prompt: `Storybook keyframe ${i + 1} of ${SHOT_COUNT}: ${shot.caption}`,
        ...ref ? { image: ref } : {}
      });
      if (paidImage) actualUsd += out.actualUsd ?? COSTS.keyframe_paid.usd;
      shot.keyframe_key = keys.reel(reelId, `shot-${i + 1}.png`);
      await env2.R2.put(shot.keyframe_key, out.value.bytes, {
        httpMetadata: { contentType: out.value.mime }
      });
      await setProgress(
        env2,
        jobId,
        KEYFRAME_PROGRESS[Math.min(i >> 1, KEYFRAME_PROGRESS.length - 1)]
      );
    }
    await env2.R2.put(keys.reel(reelId, "shots.json"), JSON.stringify(shots), {
      httpMetadata: { contentType: "application/json" }
    });
    await setProgress(env2, jobId, 100);
    const now = Date.now();
    await env2.DB.batch([
      env2.DB.prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?").bind(now, jobId),
      env2.DB.prepare("UPDATE reels SET status = 'done' WHERE id = ?").bind(reelId)
    ]);
  } catch (err) {
    if (ledger2) await compensateSpend(env2.DB, ledger2);
    await deletePrefix(env2.R2, `reels/${reelId}/`);
    throw err;
  }
  if (ledger2) await reconcileSpend(env2.DB, ledger2, actualUsd);
  if (tier === "hd") await enqueueMotion(env2, reelId, shots, jobId);
}
async function buildShotList(env2, reel, tier) {
  const text = pickProvider(env2, "shot_list", tier);
  const paidText = text.id === "openrouter-gemini-2.5-flash";
  const out = await text.complete({
    system: "You write safe, gentle children's storyboard shots.",
    prompt: `Story: ${reel.story}. Return ${SHOT_COUNT} short shot descriptions as JSON.`,
    json: true
  });
  const actualUsd = paidText ? out.actualUsd ?? COSTS.shot_list.usd : 0;
  return { shots: parseShots(out.value.text, reel.story), actualUsd };
}
async function enqueueMotion(env2, reelId, shots, parentJobId) {
  const falPaid = livePaid(env2, "fal");
  const perShot = motionUsd(SHOT_SECONDS);
  const eligible = shots.filter((s) => s.keyframe_key);
  let runnable = eligible.length;
  let skipped = 0;
  let reservation = null;
  if (falPaid && runnable > 0) {
    try {
      reservation = await guardSpend({
        env: env2,
        provider: "fal",
        estUsd: round62(runnable * perShot),
        model: MODELS.falI2V,
        step: "motion_i2v_reserve"
      });
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        skipped = runnable;
        runnable = 0;
      } else {
        throw err;
      }
    }
  }
  if (reservation) await compensateSpend(env2.DB, reservation);
  for (let i = 0; i < runnable; i++) {
    const shot = eligible[i];
    const keyframeKey = shot.keyframe_key;
    const jobId = uuid();
    const now = Date.now();
    await env2.DB.prepare(
      "INSERT INTO jobs (id, reel_id, kid_id, type, status, progress, error, attempt, payload, created_at, updated_at) VALUES (?, ?, NULL, 'motion_i2v', 'queued', 0, NULL, 0, ?, ?, ?)"
    ).bind(jobId, reelId, JSON.stringify({ shot: shot.index, keyframe_key: keyframeKey }), now, now).run();
    await env2.JOBS.send({ job_id: jobId });
  }
  if (skipped > 0) {
    await env2.DB.prepare("UPDATE jobs SET error = ?, updated_at = ? WHERE id = ?").bind(`motion_skipped_budget:${skipped}`, Date.now(), parentJobId).run();
  }
}
function round62(usd) {
  return Math.round(usd * 1e6) / 1e6;
}
async function jobReelId(env2, jobId) {
  const row = await env2.DB.prepare("SELECT reel_id FROM jobs WHERE id = ?").bind(jobId).first();
  return row?.reel_id ?? null;
}
async function latestSheetKey(env2, kidId) {
  const row = await env2.DB.prepare(
    "SELECT sheet_r2_key FROM characters WHERE kid_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(kidId).first();
  return row?.sheet_r2_key ?? null;
}
async function refFromR2(env2, key) {
  const stored = await env2.R2.get(key);
  if (!stored) return void 0;
  return {
    data: new Uint8Array(await stored.arrayBuffer()),
    mime: stored.httpMetadata?.contentType ?? "image/png"
  };
}
function parseShots(text, story) {
  let captions = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.shots)) {
      captions = parsed.shots.map(readCaption).filter((c) => c.length > 0);
    }
  } catch {
  }
  while (captions.length < SHOT_COUNT) captions.push(`${story} \u2014 beat ${captions.length + 1}`);
  return captions.slice(0, SHOT_COUNT).map((caption, i) => ({
    index: i + 1,
    caption,
    keyframe_key: null,
    video_key: null
  }));
}
function readCaption(shot) {
  if (typeof shot === "string") return shot;
  if (shot && typeof shot === "object" && "caption" in shot) {
    return String(shot.caption);
  }
  return "";
}

// src/jobs/consumer.ts
var handlers = {
  character_sheet: characterSheetJob,
  reel_generate: reelGenerateJob,
  motion_i2v: motionI2VJob
};
async function runJob(env2, jobId) {
  const job = await env2.DB.prepare("SELECT type, status FROM jobs WHERE id = ?").bind(jobId).first();
  if (!job || job.status === "done" || job.status === "failed") return;
  const handler = handlers[job.type];
  if (!handler) {
    await markFailed(env2, jobId, `unknown_job_type:${job.type}`);
    return;
  }
  await env2.DB.prepare(
    "UPDATE jobs SET status = 'running', attempt = attempt + 1, updated_at = ? WHERE id = ?"
  ).bind(Date.now(), jobId).run();
  try {
    await handler(env2, jobId);
  } catch (err) {
    await markFailed(env2, jobId, err instanceof Error ? err.message : "job_error");
  }
}

// src/env-node.ts
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}
var cached;
function getEnv() {
  if (cached) return cached;
  const url = process.env.LIBSQL_URL ?? "file:./.data/worker.db";
  const authToken = process.env.LIBSQL_AUTH_TOKEN;
  const client = createClient3({ url, ...authToken ? { authToken } : {} });
  const db = new LibsqlDb(client);
  const r2 = new LibsqlR2(client);
  const env2 = {
    __client: client,
    DB: db,
    R2: r2,
    JOBS: {
      async send(message) {
        try {
          await runJob(env2, message.job_id);
        } catch {
        }
      }
    },
    WORKER_SESSION_SECRET: requireEnv("WORKER_SESSION_SECRET"),
    ...process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {},
    ...process.env.FAL_KEY ? { FAL_KEY: process.env.FAL_KEY } : {},
    ...process.env.ENABLE_OPENROUTER ? { ENABLE_OPENROUTER: process.env.ENABLE_OPENROUTER } : {},
    ...process.env.ENABLE_FAL ? { ENABLE_FAL: process.env.ENABLE_FAL } : {},
    ...process.env.KILL_SWITCH ? { KILL_SWITCH: process.env.KILL_SWITCH } : {},
    ...process.env.MOCK_PROVIDERS ? { MOCK_PROVIDERS: process.env.MOCK_PROVIDERS } : {},
    ...process.env.ALLOWED_ORIGIN ? { ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN } : {},
    ...process.env.PUBLIC_API_BASE ? { PUBLIC_API_BASE: process.env.PUBLIC_API_BASE } : {},
    ...process.env.BUILD ? { BUILD: process.env.BUILD } : {}
  };
  cached = env2;
  return env2;
}

// src/cors.ts
var DEFAULT_ALLOWED_ORIGIN = "https://lucklypriyansh-2.github.io";
var ALLOW_METHODS = "GET, POST, OPTIONS";
var ALLOW_HEADERS = "content-type";
function allowedOrigin(env2) {
  return env2.ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN;
}
function withCors(env2, res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", allowedOrigin(env2));
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.append("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
function preflight(env2, req) {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(env2),
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": ALLOW_METHODS,
      "Access-Control-Allow-Headers": ALLOW_HEADERS,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin"
    }
  });
}

// src/auth/session.ts
var SESSION_COOKIE = "sb_session";
function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function signSessionId(secret, id) {
  return toBase64Url(await hmac(secret, id));
}
function sessionCookie(id, sig) {
  return [
    `${SESSION_COOKIE}=${id}.${sig}`,
    "Secure",
    "HttpOnly",
    "SameSite=None",
    "Partitioned",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1e3)}`
  ].join("; ");
}
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Secure; HttpOnly; SameSite=None; Partitioned; Path=/; Max-Age=0`;
}
async function createSession(env2, userId, now = Date.now()) {
  const id = randomToken();
  const sig = await signSessionId(env2.WORKER_SESSION_SECRET, id);
  await env2.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(await sha256Hex(id), userId, now + SESSION_TTL_MS, now).run();
  const token = `${id}.${sig}`;
  return { id, cookie: sessionCookie(id, sig), token };
}
function readSessionCookie(req) {
  const auth = req.headers.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}
async function verifySessionCookie(secret, cookieValue) {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  const id = cookieValue.slice(0, dot);
  let provided;
  try {
    provided = fromBase64Url(cookieValue.slice(dot + 1));
  } catch {
    return null;
  }
  const expected = await hmac(secret, id);
  return timingSafeEqual(expected, provided) ? id : null;
}
async function resolveSession(env2, req, now = Date.now()) {
  const id = await verifySessionCookie(env2.WORKER_SESSION_SECRET, readSessionCookie(req));
  if (!id) return null;
  const hashedId = await sha256Hex(id);
  const row = await env2.DB.prepare(
    `SELECT s.expires_at, u.id AS user_id, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  ).bind(hashedId).first();
  if (!row || row.expires_at <= now) return null;
  return { user_id: row.user_id, is_admin: row.is_admin === 1, session_id: hashedId };
}

// src/auth/middleware.ts
async function requireSession(env2, req) {
  const session = await resolveSession(env2, req);
  if (!session) throw new Unauthorized();
  return session;
}
async function requireAdmin(env2, req) {
  const session = await requireSession(env2, req);
  if (!session.is_admin) throw new Forbidden("admin_only");
  return session;
}

// src/util/http.ts
function clientIp(req) {
  const cf = req.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  const forwarded = req.headers.get("X-Forwarded-For");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "0.0.0.0";
}
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new BadRequest("invalid_json");
  }
}
function requireString(body, field) {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequest(`${field}_required`);
  }
  return value.trim();
}

// src/routes/admin.ts
async function ledger({ env: env2, req }) {
  await requireAdmin(env2, req);
  const provider = new URL(req.url).searchParams.get("provider");
  const rows = await env2.DB.prepare(
    `SELECT id, user_id, provider, model, step, est_usd, actual_usd, request_id, created_at
       FROM ledger ${provider ? "WHERE provider = ?" : ""}
      ORDER BY created_at DESC LIMIT 200`
  ).bind(...provider ? [provider] : []).all();
  const totals = await env2.DB.prepare(
    "SELECT provider, total_usd FROM budget_state ORDER BY provider"
  ).all();
  const totalsMap = {};
  for (const row of totals.results) totalsMap[row.provider] = row.total_usd;
  return Response.json({ totals: totalsMap, rows: rows.results });
}
async function killSwitch({ env: env2, req }) {
  await requireAdmin(env2, req);
  const body = await readJson(req);
  if (typeof body.enabled !== "boolean") throw new BadRequest("enabled_required");
  await setKillSwitch(
    env2,
    body.enabled,
    typeof body.reason === "string" ? body.reason : void 0
  );
  return Response.json({ enabled: body.enabled });
}

// src/auth/invite.ts
async function validateInvite(db, code) {
  const row = await db.prepare("SELECT code, max_uses, used_count FROM invite_codes WHERE code = ?").bind(code).first();
  if (!row) throw new Unauthorized("unknown_invite_code");
  if (row.used_count >= row.max_uses) throw new Unauthorized("invite_code_exhausted");
  return row;
}
async function consumeInvite(db, code) {
  const result = await db.prepare(
    "UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ? AND used_count < max_uses"
  ).bind(code).run();
  return (result.meta.changes ?? 0) === 1;
}

// src/util/day.ts
function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
}
function utcHour(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

// src/budget/rate_limit.ts
async function consumeBucket(db, key, scope, limit, now) {
  await db.prepare(
    "INSERT INTO rate_buckets (key, tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING"
  ).bind(key, limit, now).run();
  const taken = await db.prepare(
    "UPDATE rate_buckets SET tokens = tokens - 1, updated_at = ? WHERE key = ? AND tokens >= 1"
  ).bind(now, key).run();
  if ((taken.meta.changes ?? 0) !== 1) throw new RateLimited(scope);
  const row = await db.prepare("SELECT tokens FROM rate_buckets WHERE key = ?").bind(key).first();
  return row?.tokens ?? 0;
}
function consumeDaily(db, scope, userId, limit, now = Date.now()) {
  return consumeBucket(db, `${scope}:${userId}:${utcDay(now)}`, scope, limit, now);
}
function consumeCharacter(db, userId, now = Date.now()) {
  return consumeDaily(db, "chars", userId, DAILY_LIMITS.chars, now);
}
function consumeReel(db, userId, now = Date.now()) {
  return consumeDaily(db, "reels", userId, DAILY_LIMITS.reels, now);
}
function consumeInviteAttempt(db, ip, now = Date.now()) {
  return consumeBucket(db, `invite:${ip}:${utcHour(now)}`, "invite", INVITE_LIMITS.perHour, now);
}

// src/routes/auth.ts
async function invite({ env: env2, req }) {
  const body = await readJson(req);
  const code = requireString(body, "code");
  const email = requireString(body, "email");
  await consumeInviteAttempt(env2.DB, clientIp(req));
  await validateInvite(env2.DB, code);
  const emailHash = await sha256Hex(email.toLowerCase());
  let user = await env2.DB.prepare("SELECT id, is_admin FROM users WHERE email_hash = ?").bind(emailHash).first();
  if (!user) {
    if (!await consumeInvite(env2.DB, code)) throw new Unauthorized("invite_code_exhausted");
    const id = uuid();
    await env2.DB.prepare(
      "INSERT INTO users (id, email_hash, invite_code, is_admin, created_at) VALUES (?, ?, ?, 0, ?)"
    ).bind(id, emailHash, code, Date.now()).run();
    user = { id, is_admin: 0 };
  }
  const { cookie, token } = await createSession(env2, user.id);
  return Response.json(
    { user_id: user.id, is_admin: user.is_admin === 1, session_token: token },
    { headers: { "Set-Cookie": cookie } }
  );
}
async function me({ env: env2, req }) {
  const session = await requireSession(env2, req);
  return Response.json({ user_id: session.user_id, is_admin: session.is_admin });
}
async function logout({ env: env2, req }) {
  const session = await requireSession(env2, req);
  await env2.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.session_id).run();
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

// src/routes/consent.ts
async function create({ env: env2, req }) {
  const session = await requireSession(env2, req);
  const body = await readJson(
    req
  );
  const kidId = requireString(body, "kid_id");
  const parentName = requireString(body, "parent_name");
  if (typeof body.others_consented !== "boolean") throw new BadRequest("others_consented_required");
  const kid = await env2.DB.prepare("SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(kidId, session.user_id).first();
  if (!kid) throw new Forbidden("kid_not_found");
  const consentId = uuid();
  await env2.DB.prepare(
    "INSERT INTO consents (id, user_id, kid_id, parent_name, others_consented, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(consentId, session.user_id, kidId, parentName, body.others_consented ? 1 : 0, Date.now()).run();
  return Response.json({ consent_id: consentId });
}

// src/routes/health.ts
async function get({ env: env2 }) {
  const flags = readFlags(env2);
  return Response.json({
    ok: true,
    build: env2.BUILD ?? "dev",
    flags: {
      openrouter: flags.openrouter,
      fal: flags.fal,
      kill: await isKilled(env2)
    }
  });
}

// src/routes/jobs.ts
async function get2({ env: env2, req, params }) {
  const session = await requireSession(env2, req);
  const job = await env2.DB.prepare(
    `SELECT j.id, j.type, j.status, j.progress, j.error
       FROM jobs j
      WHERE j.id = ?
        AND (j.reel_id IN (SELECT id FROM reels WHERE user_id = ?)
             OR j.kid_id IN (SELECT id FROM kids WHERE user_id = ?))`
  ).bind(params.id ?? "", session.user_id, session.user_id).first();
  if (!job) throw new NotFound("job_not_found");
  return Response.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    ...job.error ? { error: job.error } : {}
  });
}

// src/jobs/inline.ts
async function maybeRunInline(env2, jobId) {
  await runJob(env2, jobId);
}

// src/routes/kids.ts
async function list({ env: env2, req }) {
  const session = await requireSession(env2, req);
  const rows = await env2.DB.prepare(
    `SELECT k.id, k.display_name,
            EXISTS (SELECT 1 FROM characters c WHERE c.kid_id = k.id) AS has_sheet
       FROM kids k WHERE k.user_id = ? AND k.deleted_at IS NULL ORDER BY k.created_at`
  ).bind(session.user_id).all();
  return Response.json({
    kids: rows.results.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      has_sheet: r.has_sheet === 1
    }))
  });
}
async function create2({ env: env2, req }) {
  const session = await requireSession(env2, req);
  const body = await readJson(req);
  const displayName = requireString(body, "display_name");
  const id = uuid();
  await env2.DB.prepare(
    "INSERT INTO kids (id, user_id, display_name, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL)"
  ).bind(id, session.user_id, displayName, Date.now()).run();
  return Response.json({ kid_id: id });
}
async function forget({ env: env2, req, params }) {
  const session = await requireSession(env2, req);
  const kidId = params.id ?? "";
  const kid = await env2.DB.prepare("SELECT id, deleted_at FROM kids WHERE id = ? AND user_id = ?").bind(kidId, session.user_id).first();
  if (!kid) throw new NotFound("kid_not_found");
  if (kid.deleted_at !== null) return Response.json({ ok: true, deleted: { r2: 0, rows: 0 } });
  const inflight = await env2.DB.prepare(
    `SELECT p.id, p.r2_key FROM photos_tmp p
       JOIN jobs j ON j.photo_id = p.id
      WHERE j.kid_id = ? AND p.user_id = ? AND p.deleted_at IS NULL`
  ).bind(kidId, session.user_id).all();
  for (const photo of inflight.results) await deleteObject(env2.R2, photo.r2_key);
  let r2Deleted = await deletePrefix(env2.R2, `sheets/${kidId}/`);
  const reels = await env2.DB.prepare("SELECT id FROM reels WHERE kid_id = ? AND user_id = ?").bind(kidId, session.user_id).all();
  for (const reel of reels.results) r2Deleted += await deletePrefix(env2.R2, `reels/${reel.id}/`);
  const now = Date.now();
  await env2.DB.batch([
    env2.DB.prepare("UPDATE kids SET deleted_at = ? WHERE id = ?").bind(now, kidId),
    env2.DB.prepare("DELETE FROM characters WHERE kid_id = ?").bind(kidId),
    env2.DB.prepare("DELETE FROM consents WHERE kid_id = ?").bind(kidId),
    ...inflight.results.map(
      (p) => env2.DB.prepare("UPDATE photos_tmp SET deleted_at = ? WHERE id = ?").bind(now, p.id)
    )
  ]);
  return Response.json({ ok: true, deleted: { r2: r2Deleted, rows: 1 + reels.results.length } });
}
async function characterSheet({ env: env2, req, params }) {
  const session = await requireSession(env2, req);
  const kidId = params.id ?? "";
  const body = await readJson(req);
  const photoId = requireString(body, "photo_id");
  const consentId = requireString(body, "consent_id");
  const kid = await env2.DB.prepare("SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(kidId, session.user_id).first();
  if (!kid) throw new NotFound("kid_not_found");
  const consent = await env2.DB.prepare(
    "SELECT id FROM consents WHERE id = ? AND kid_id = ? AND user_id = ?"
  ).bind(consentId, kidId, session.user_id).first();
  if (!consent) throw new Forbidden("consent_required");
  const photo = await env2.DB.prepare(
    "SELECT id FROM photos_tmp WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  ).bind(photoId, session.user_id).first();
  if (!photo) throw new BadRequest("photo_not_found");
  if (await isKilled(env2)) throw new KillSwitchOn();
  if (livePaid(env2, "openrouter")) {
    await assertHeadroom(env2.DB, "openrouter", COSTS.character_sheet.usd);
  }
  const jobId = uuid();
  const now = Date.now();
  await env2.DB.prepare(
    "INSERT INTO jobs (id, reel_id, kid_id, type, status, progress, error, attempt, photo_id, consent_id, created_at, updated_at) VALUES (?, NULL, ?, 'character_sheet', 'queued', 0, NULL, 0, ?, ?, ?, ?)"
  ).bind(jobId, kidId, photoId, consentId, now, now).run();
  await env2.JOBS.send({ job_id: jobId });
  await consumeCharacter(env2.DB, session.user_id);
  await maybeRunInline(env2, jobId);
  return Response.json({ job_id: jobId });
}

// src/routes/media.ts
async function get3({ env: env2, req, params }) {
  const key = params.key ?? "";
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!await verifyMediaSignature(env2.WORKER_SESSION_SECRET, key, exp, sig)) {
    throw new Unauthorized("invalid_media_signature");
  }
  const object = await env2.R2.get(key);
  if (!object) throw new NotFound("media_not_found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

// src/routes/photos.ts
async function upload({ env: env2, req }) {
  const session = await requireSession(env2, req);
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) throw new BadRequest("photo_required");
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) throw new BadRequest("photo_too_large");
  if (!PHOTO_MIME_ALLOWLIST.includes(file.type)) {
    throw new BadRequest("photo_type_not_allowed");
  }
  const id = uuid();
  const key = await putTmp(env2.R2, id, await file.arrayBuffer(), file.type);
  await env2.DB.prepare(
    "INSERT INTO photos_tmp (id, user_id, r2_key, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL)"
  ).bind(id, session.user_id, key, Date.now()).run();
  return Response.json({ photo_id: id });
}

// src/routes/reels.ts
var TIERS = ["free", "paid", "hd"];
function parseTier(value) {
  if (typeof value !== "string" || !TIERS.includes(value)) throw new BadRequest("invalid_tier");
  return value;
}
async function create3({ env: env2, req }) {
  const session = await requireSession(env2, req);
  const body = await readJson(req);
  const kidId = requireString(body, "kid_id");
  const story = requireString(body, "story");
  const tier = parseTier(body.tier);
  const kid = await env2.DB.prepare("SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(kidId, session.user_id).first();
  if (!kid) throw new NotFound("kid_not_found");
  const flags = readFlags(env2);
  if (tier !== "free") {
    if (await isKilled(env2)) throw new KillSwitchOn();
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    await assertHeadroom(env2.DB, "openrouter", prechargeUsd("paid"));
  }
  if (tier === "hd") {
    if (!flags.mockProviders && !flags.fal) throw new ProviderDisabled("fal");
    await assertHeadroom(env2.DB, "fal", SHOT_COUNT * SHOT_SECONDS * COSTS.motion_i2v.usdPerSecond);
  }
  const reelId = uuid();
  const jobId = uuid();
  const now = Date.now();
  await env2.DB.batch([
    env2.DB.prepare(
      "INSERT INTO reels (id, user_id, kid_id, status, tier, story, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)"
    ).bind(reelId, session.user_id, kidId, tier, story, now),
    env2.DB.prepare(
      "INSERT INTO jobs (id, reel_id, kid_id, type, status, progress, error, attempt, created_at, updated_at) VALUES (?, ?, ?, 'reel_generate', 'queued', 0, NULL, 0, ?, ?)"
    ).bind(jobId, reelId, kidId, now, now)
  ]);
  await env2.JOBS.send({ job_id: jobId });
  await consumeReel(env2.DB, session.user_id);
  await maybeRunInline(env2, jobId);
  return Response.json({ reel_id: reelId, job_id: jobId });
}
async function list2({ env: env2, req }) {
  const session = await requireSession(env2, req);
  const rows = await env2.DB.prepare(
    "SELECT id, status, created_at FROM reels WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(session.user_id).all();
  return Response.json({ reels: rows.results });
}
async function get4({ env: env2, req, params }) {
  const session = await requireSession(env2, req);
  const reel = await env2.DB.prepare(
    "SELECT id, status, tier FROM reels WHERE id = ? AND user_id = ?"
  ).bind(params.id ?? "", session.user_id).first();
  if (!reel) throw new NotFound("reel_not_found");
  const manifest = await env2.R2.get(keys.reel(reel.id, "shots.json"));
  const stored = manifest ? await manifest.json() : [];
  const shots = await Promise.all(
    stored.map(async (s) => ({
      index: s.index,
      caption: s.caption,
      keyframe_url: s.keyframe_key ? await mediaUrl(env2, s.keyframe_key) : null,
      video_url: s.video_key ? await mediaUrl(env2, s.video_key) : null
    }))
  );
  return Response.json({ id: reel.id, status: reel.status, tier: reel.tier, shots });
}

// src/router.ts
function route(method, path, handler) {
  const names = [];
  const pattern = new RegExp(
    "^" + path.replace(/:[A-Za-z]+/g, (m) => {
      names.push(m.slice(1));
      return "([^/]+)";
    }) + "$"
  );
  return {
    method,
    pattern,
    handler: (ctx) => {
      const match = ctx.req.url ? new URL(ctx.req.url).pathname.match(pattern) : null;
      const params = { ...ctx.params };
      if (match) names.forEach((n, i) => params[n] = decodeURIComponent(match[i + 1] ?? ""));
      return handler({ ...ctx, params });
    }
  };
}
var routes = [
  route("GET", "/api/health", get),
  route("POST", "/api/auth/invite", invite),
  route("GET", "/api/auth/me", me),
  route("POST", "/api/auth/logout", logout),
  route("POST", "/api/consent", create),
  route("GET", "/api/kids", list),
  route("POST", "/api/kids", create2),
  route("POST", "/api/kids/:id/forget", forget),
  route("POST", "/api/kids/:id/character_sheet", characterSheet),
  route("POST", "/api/photos", upload),
  route("POST", "/api/reels", create3),
  route("GET", "/api/reels", list2),
  route("GET", "/api/reels/:id", get4),
  route("GET", "/api/jobs/:id", get2),
  route("GET", "/api/admin/ledger", ledger),
  route("POST", "/api/admin/kill-switch", killSwitch)
];
var MEDIA_PREFIX = "/api/media/";
async function dispatch(env2, req) {
  const { pathname } = new URL(req.url);
  if (req.method === "GET" && pathname.startsWith(MEDIA_PREFIX)) {
    const key = decodeURIComponent(pathname.slice(MEDIA_PREFIX.length));
    return get3({ env: env2, req, params: { key } });
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    if (!r.pattern.test(pathname)) continue;
    return r.handler({ env: env2, req, params: {} });
  }
  throw new NotFound();
}

// src/handler.ts
async function handleRequest(env2, req) {
  const pre = preflight(env2, req);
  if (pre) return pre;
  try {
    return withCors(env2, await dispatch(env2, req));
  } catch (err) {
    if (!(err instanceof NotFound)) {
      console.error("request_failed", err instanceof Error ? err.name : "unknown");
    }
    return withCors(env2, errorResponse(err));
  }
}

// src/jobs/recover.ts
async function recoverStaleJobs(env2, now = Date.now(), maxAgeMs = 10 * 6e4) {
  const cutoff = now - maxAgeMs;
  const rows = await env2.DB.prepare(
    "SELECT id FROM jobs WHERE status IN ('queued','running') AND updated_at <= ? ORDER BY updated_at LIMIT 20"
  ).bind(cutoff).all();
  let n = 0;
  for (const row of rows.results) {
    try {
      await runJob(env2, row.id);
      n++;
    } catch {
    }
  }
  return n;
}

// src/scheduled/reset_daily.ts
async function resetDaily(env2, now = Date.now()) {
  const result = await env2.DB.prepare(
    "DELETE FROM rate_buckets WHERE key LIKE '%:%' AND key NOT LIKE ? AND key NOT LIKE ?"
  ).bind(`%:${utcDay(now)}`, `%:${utcHour(now)}`).run();
  return result.meta.changes ?? 0;
}

// src/scheduled/sweep_tmp.ts
async function sweepTmp(env2, now = Date.now()) {
  let cursor;
  let deleted = 0;
  do {
    const listed = await env2.R2.list({ prefix: "tmp/", cursor });
    for (const object of listed.objects) {
      const uploadedAt = Number(object.customMetadata?.uploaded_at ?? 0);
      if (!uploadedAt || now - uploadedAt < TMP_MAX_AGE_MS) continue;
      const row = await env2.DB.prepare(
        "SELECT id FROM photos_tmp WHERE r2_key = ? AND deleted_at IS NULL"
      ).bind(object.key).first();
      if (row) continue;
      await env2.R2.delete(object.key);
      deleted++;
    }
    cursor = listed.truncated ? listed.cursor : void 0;
  } while (cursor);
  return deleted;
}

// src/node-server.ts
async function toFetchRequest(req) {
  const host = req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === void 0) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else headers.set(name, String(value));
  }
  const method = (req.method ?? "GET").toUpperCase();
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length > 0) init.body = Buffer.concat(chunks);
  }
  return new Request(url, init);
}
async function writeFetchResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
async function seedInviteIfConfigured(env2) {
  const code = process.env.INVITE_SEED_CODE;
  if (!code) return;
  const maxUses = Number(process.env.INVITE_SEED_MAX_USES ?? "20");
  await env2.DB.prepare(
    "INSERT OR REPLACE INTO invite_codes (code, max_uses, used_count, note) VALUES (?, ?, COALESCE((SELECT used_count FROM invite_codes WHERE code = ?), 0), ?)"
  ).bind(code, maxUses, code, "seed").run();
}
var env = getEnv();
void seedInviteIfConfigured(env).catch(() => {
  console.error("invite_seed_failed");
});
var port = Number(process.env.PORT ?? 8787);
var server = createServer(async (req, res) => {
  try {
    const fetchReq = await toFetchRequest(req);
    const fetchRes = await handleRequest(env, fetchReq);
    await writeFetchResponse(res, fetchRes);
  } catch (err) {
    console.error("server_error", err instanceof Error ? err.name : "unknown");
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "internal_error" }));
  }
});
server.listen(port, () => {
  process.stdout.write(`worker listening on http://localhost:${port}
`);
});
setInterval(() => {
  Promise.all([sweepTmp(env), resetDaily(env), recoverStaleJobs(env)]).catch((err) => {
    console.error("scheduled_error", err instanceof Error ? err.name : "unknown");
  });
}, 6e4);
