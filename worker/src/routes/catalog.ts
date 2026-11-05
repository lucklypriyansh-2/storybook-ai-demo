import type { Ctx } from "../router";
import {
  getShots,
  getTemplate,
  listTemplates,
  toDto,
  toShotDto,
} from "../catalog/templates";
import { mediaUrl } from "../storage/signed";
import { ApiError } from "../util/errors";

/**
 * Public catalog read paths (R.1.2/R.1.4). No session required: the browse feed
 * is the product's front door and contains no user data.
 * A `cover_key` prefixed `local:` points at a bundled placeholder cover shipped
 * with the SPA; anything else is treated as a stored object and signed.
 */
async function coverUrl(env: Ctx["env"], key: string | null): Promise<string | null> {
  if (!key) return null;
  if (key.startsWith("local:")) return key;
  return mediaUrl(env, key);
}

export async function list({ env }: Ctx): Promise<Response> {
  const rows = await listTemplates(env.DB, { enabledOnly: true });
  const templates = await Promise.all(
    rows.map(async (row) => ({ ...toDto(row), cover_url: await coverUrl(env, row.cover_key) })),
  );
  return Response.json({ templates });
}

export async function detail({ env, params }: Ctx): Promise<Response> {
  const row = await getTemplate(env.DB, params.id ?? "");
  if (!row || row.enabled !== 1) throw new ApiError(404, "template_not_found");
  const shots = await getShots(env.DB, row.id);
  return Response.json({
    template: { ...toDto(row), cover_url: await coverUrl(env, row.cover_key) },
    shots: shots.map(toShotDto),
  });
}
