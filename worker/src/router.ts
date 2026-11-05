import type { Env } from "./env";
import { NotFound } from "./util/errors";
import * as admin from "./routes/admin";
import * as auth from "./routes/auth";
import * as consent from "./routes/consent";
import * as health from "./routes/health";
import * as jobs from "./routes/jobs";
import * as kids from "./routes/kids";
import * as media from "./routes/media";
import * as photos from "./routes/photos";
import * as reels from "./routes/reels";

export type Ctx = { env: Env; req: Request; params: Record<string, string> };
export type Handler = (ctx: Ctx) => Promise<Response>;

type Route = { method: string; pattern: RegExp; handler: Handler };

function route(method: string, path: string, handler: Handler): Route {
  const names: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:[A-Za-z]+/g, (m) => {
        names.push(m.slice(1));
        return "([^/]+)";
      }) +
      "$",
  );
  return {
    method,
    pattern,
    handler: (ctx) => {
      const match = ctx.req.url ? new URL(ctx.req.url).pathname.match(pattern) : null;
      const params = { ...ctx.params };
      if (match) names.forEach((n, i) => (params[n] = decodeURIComponent(match[i + 1] ?? "")));
      return handler({ ...ctx, params });
    },
  };
}

const routes: Route[] = [
  route("GET", "/api/health", health.get),
  route("POST", "/api/auth/invite", auth.invite),
  route("GET", "/api/auth/me", auth.me),
  route("POST", "/api/auth/logout", auth.logout),

  route("POST", "/api/consent", consent.create),
  route("GET", "/api/kids", kids.list),
  route("POST", "/api/kids", kids.create),
  route("POST", "/api/kids/:id/forget", kids.forget),
  route("POST", "/api/kids/:id/character_sheet", kids.characterSheet),
  route("POST", "/api/photos", photos.upload),
  route("POST", "/api/reels", reels.create),
  route("GET", "/api/reels", reels.list),
  route("GET", "/api/reels/:id", reels.get),
  route("GET", "/api/jobs/:id", jobs.get),

  route("GET", "/api/admin/ledger", admin.ledger),
  route("POST", "/api/admin/kill-switch", admin.killSwitch),
];

const MEDIA_PREFIX = "/api/media/";

export async function dispatch(env: Env, req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  // Media keys contain slashes, so the greedy prefix match is handled here.
  if (req.method === "GET" && pathname.startsWith(MEDIA_PREFIX)) {
    const key = decodeURIComponent(pathname.slice(MEDIA_PREFIX.length));
    return media.get({ env, req, params: { key } });
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    if (!r.pattern.test(pathname)) continue;
    return r.handler({ env, req, params: {} });
  }
  throw new NotFound();
}
