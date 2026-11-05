// Portable Node HTTP entry — equivalent of src/index.ts for the Cloudflare
// build. Wraps the fetch-style dispatch in node:http, and runs the scheduled
// sweepTmp / resetDaily + stale-job recovery on a timer.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getEnv } from "./env-node";
import { handleRequest } from "./handler";
import { recoverStaleJobs } from "./jobs/recover";
import { resetDaily } from "./scheduled/reset_daily";
import { sweepTmp } from "./scheduled/sweep_tmp";

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

const env = getEnv();
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
setInterval(() => {
  Promise.all([sweepTmp(env), resetDaily(env), recoverStaleJobs(env)]).catch((err) => {
    console.error("scheduled_error", err instanceof Error ? err.name : "unknown");
  });
}, 60_000);
