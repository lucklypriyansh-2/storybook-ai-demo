import type { Env } from "./env";
import { preflight, withCors } from "./cors";
import { dispatch } from "./router";
import { errorResponse, NotFound } from "./util/errors";

/** The CF-free request handler shared by node-server.ts and api/index.ts. */
export async function handleRequest(env: Env, req: Request): Promise<Response> {
  const pre = preflight(env, req);
  if (pre) return pre;
  try {
    return withCors(env, await dispatch(env, req));
  } catch (err) {
    if (!(err instanceof NotFound)) {
      console.error("request_failed", err instanceof Error ? err.name : "unknown");
    }
    return withCors(env, errorResponse(err));
  }
}
