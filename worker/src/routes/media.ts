import type { Ctx } from "../router";
import { verifyMediaSignature } from "../storage/signed";
import { NotFound, Unauthorized } from "../util/errors";

/** Streams an R2 object when the request carries a valid HMAC signature (H-8/H-9). */
export async function get({ env, req, params }: Ctx): Promise<Response> {
  const key = params.key ?? "";
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";

  if (!(await verifyMediaSignature(env.WORKER_SESSION_SECRET, key, exp, sig))) {
    throw new Unauthorized("invalid_media_signature");
  }

  const object = await env.R2.get(key);
  if (!object) throw new NotFound("media_not_found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
