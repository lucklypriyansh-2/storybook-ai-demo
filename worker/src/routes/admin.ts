import type { Ctx } from "../router";
import { requireAdmin } from "../auth/middleware";
import { setKillSwitch } from "../budget/kill_switch";
import { readJson } from "../util/http";
import { BadRequest } from "../util/errors";

export async function ledger({ env, req }: Ctx): Promise<Response> {
  await requireAdmin(env, req);
  const provider = new URL(req.url).searchParams.get("provider");

  const rows = await env.DB.prepare(
    `SELECT id, user_id, provider, model, step, est_usd, actual_usd, request_id, created_at
       FROM ledger ${provider ? "WHERE provider = ?" : ""}
      ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(...(provider ? [provider] : []))
    .all();

  const totals = await env.DB.prepare(
    "SELECT provider, total_usd FROM budget_state ORDER BY provider",
  ).all<{ provider: string; total_usd: number }>();

  const totalsMap: Record<string, number> = {};
  for (const row of totals.results) totalsMap[row.provider] = row.total_usd;

  return Response.json({ totals: totalsMap, rows: rows.results });
}

export async function killSwitch({ env, req }: Ctx): Promise<Response> {
  await requireAdmin(env, req);
  const body = await readJson<{ enabled?: unknown; reason?: unknown }>(req);
  if (typeof body.enabled !== "boolean") throw new BadRequest("enabled_required");

  await setKillSwitch(
    env,
    body.enabled,
    typeof body.reason === "string" ? body.reason : undefined,
  );
  return Response.json({ enabled: body.enabled });
}
