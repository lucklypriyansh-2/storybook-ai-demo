// Portable Node HTTP entry — equivalent of src/index.ts for the Cloudflare
// build. Wraps the fetch-style dispatch in node:http, and runs the scheduled
// sweepTmp / resetDaily + stale-job recovery on a timer.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getEnv } from "./env-node";
import { handleRequest } from "./handler";
import { recoverStaleJobs } from "./jobs/recover";
import { resetDaily } from "./scheduled/reset_daily";
import { sweepAll } from "./scheduled/sweep_tmp";
import { startFfmpegProbe } from "./config/ffmpeg";
import { SWEEP_INTERVAL_MS } from "./config/limits";

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  const url = `${proto}://${host}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else headers.set(name, String(value));
  }

  const method = (req.method ?? "GET").toUpperCase();
  const init: RequestInit = { method, headers };

  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (chunks.length > 0) init.body = Buffer.concat(chunks);
  }

  return new Request(url, init);
}

async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}


async function seedInviteIfConfigured(env: ReturnType<typeof getEnv>): Promise<void> {
  const code = process.env.INVITE_SEED_CODE;
  if (!code) return;
  const maxUses = Number(process.env.INVITE_SEED_MAX_USES ?? "20");
  await env.DB.prepare(
    "INSERT OR REPLACE INTO invite_codes (code, max_uses, used_count, note) VALUES (?, ?, COALESCE((SELECT used_count FROM invite_codes WHERE code = ?), 0), ?)",
  )
    .bind(code, maxUses, code, "seed")
    .run();
}

const env = getEnv();
void seedInviteIfConfigured(env).catch(() => {
  console.error("invite_seed_failed");
});
// Phase C #8: probe ffmpeg once at boot, fire-and-forget. /api/health then reads
// the cache instead of blocking on an exec (and an unresolved probe stays null).
startFfmpegProbe();
const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (req, res) => {
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
  process.stdout.write(`worker listening on http://localhost:${port}\n`);
});

// Scheduled work in-process on an interval, matching the CF `scheduled` hook.
// sweepAll runs the 24h photo pass before the tmp-orphan pass, so the copy on
// the photo card ("deleted within 24 h") is backed by an actual timer.
setInterval(() => {
  Promise.all([sweepAll(env), resetDaily(env), recoverStaleJobs(env)]).catch((err) => {
    console.error("scheduled_error", err instanceof Error ? err.name : "unknown");
  });
}, SWEEP_INTERVAL_MS);
