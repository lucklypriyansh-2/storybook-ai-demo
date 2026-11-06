// Vercel serverless entry. Every /api/* path is routed here (vercel.json) and
// forwarded to the shared fetch-style handler. Shares the same Env/libSQL
// client across warm invocations via env-node's module-level cache.
import type { IncomingMessage, ServerResponse } from "node:http";
import { getEnv } from "../src/env-node";
import { handleRequest } from "../src/handler";
import { recoverStaleJobs } from "../src/jobs/recover";
import { resetDaily } from "../src/scheduled/reset_daily";
import { sweepAll } from "../src/scheduled/sweep_tmp";
import { startFfmpegProbe } from "../src/config/ffmpeg";

export const config = { maxDuration: 60 };

// Cold start: kick the ffmpeg probe off so the cache is warm for /api/health and
// this function never blocks a request on an exec.
startFfmpegProbe();

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
  const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
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

let lastSweep = 0;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const env = getEnv();

  // Opportunistic sweep on first request after ~5 min of warmth; Vercel Hobby
  // has no scheduled invocations without Cron Jobs, so piggy-back on real
  // traffic for the 24h photo pass + tmp sweep / resetDaily / stale-job recovery.
  const now = Date.now();
  if (now - lastSweep > 5 * 60_000) {
    lastSweep = now;
    Promise.all([sweepAll(env), resetDaily(env), recoverStaleJobs(env)]).catch(() => {});
  }

  try {
    const fetchReq = await toFetchRequest(req);
    const fetchRes = await handleRequest(env, fetchReq);
    await writeFetchResponse(res, fetchRes);
  } catch (err) {
    console.error("server_error", err instanceof Error ? err.name : "unknown");
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "internal_error" }));
  }
}
