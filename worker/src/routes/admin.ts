import type { Ctx } from "../router";
import { requireAdmin, requireSession } from "../auth/middleware";
import {
  createTemplate,
  deleteTemplate,
  getShots,
  getTemplate,
  getTemplateBySlug,
  listTemplates,
  patchTemplate,
  slugify,
  toDto,
  toShotDto,
  type ShotPatch,
} from "../catalog/templates";
import { setKillSwitch } from "../budget/kill_switch";
import { readJson } from "../util/http";
import { timingSafeEqual } from "../util/hash";
import { ApiError, BadRequest } from "../util/errors";

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

/**
 * R.2.1 Admin bootstrap. `users.is_admin` is granted out of band by the
 * operator: POST with X-Admin-Token matching the ADMIN_TOKEN env var promotes
 * the *already-signed-in* session user. No token value lives in the repo and
 * the token is never echoed or logged — only a boolean comparison outcome.
 */
export async function bootstrap({ env, req }: Ctx): Promise<Response> {
  const configured = env.ADMIN_TOKEN;
  if (!configured) {
    return Response.json({ error: "admin_token_unset" }, { status: 503 });
  }

  const session = await requireSession(env, req);
  const provided = req.headers.get("X-Admin-Token") ?? "";
  if (!(await tokensMatch(configured, provided))) throw new ApiError(401, "admin_token_invalid");

  const now = Date.now();
  await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(session.user_id).run();
  return Response.json({ ok: true, user_id: session.user_id, is_admin: true, updated_at: now });
}

/** HMAC-free constant-time compare over the UTF-8 bytes so length never leaks. */
async function tokensMatch(configured: string, provided: string): Promise<boolean> {
  if (!provided) return false;
  const enc = new TextEncoder();
  const a = enc.encode(configured);
  const b = enc.encode(provided);
  const length = Math.max(a.length, b.length);
  const pa = new Uint8Array(length);
  const pb = new Uint8Array(length);
  pa.set(a);
  pb.set(b);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

// ---- A-02/A-03 template catalog CRUD (requireAdmin) ----

export async function listTemplatesRoute({ env, req }: Ctx): Promise<Response> {
  await requireAdmin(env, req);
  const rows = await listTemplates(env.DB);
  return Response.json({ templates: rows.map(toDto) });
}

export async function getTemplateRoute({ env, req, params }: Ctx): Promise<Response> {
  await requireAdmin(env, req);
  const row = await getTemplate(env.DB, params.id ?? "");
  if (!row) throw new ApiError(404, "template_not_found");
  const shots = await getShots(env.DB, row.id);
  return Response.json({ template: toDto(row), shots: shots.map(toShotDto) });
}

export async function createTemplateRoute({ env, req }: Ctx): Promise<Response> {
  await requireAdmin(env, req);
  const body = await readJson<TemplateBody>(req);
  const title = readTitle(body);
  const slug = typeof body.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(title);
  if (await getTemplateBySlug(env.DB, slug)) throw new BadRequest("slug_taken");

  const row = await createTemplate(env.DB, {
    title,
    slug,
    cover_key: readCoverKey(body),
    description: typeof body.description === "string" ? body.description : null,
    age_band: typeof body.age_band === "string" ? body.age_band : undefined,
    tier_default: typeof body.tier_default === "string" ? body.tier_default : undefined,
    page_count: body.page_count === undefined ? undefined : readPageCount(body),
    enabled: body.enabled === undefined ? true : body.enabled === true,
  });
  return Response.json({ template: toDto(row) });
}

export async function patchTemplateRoute({ env, req, params }: Ctx): Promise<Response> {
  await requireAdmin(env, req);
  const id = params.id ?? "";
  const body = await readJson<TemplateBody & { scene_prompts?: unknown }>(req);

  const patch: Parameters<typeof patchTemplate>[2] = {};
  if (body.title !== undefined) patch.title = readTitle(body);
  if (body.slug !== undefined && typeof body.slug === "string") patch.slug = slugify(body.slug);
  if (body.description !== undefined && typeof body.description === "string") patch.description = body.description;
  if (body.age_band !== undefined && typeof body.age_band === "string") patch.age_band = body.age_band;
  if (body.tier_default !== undefined && typeof body.tier_default === "string") patch.tier_default = body.tier_default;
  if (body.cover_key !== undefined) patch.cover_key = readCoverKey(body);
  if (body.page_count !== undefined) patch.page_count = readPageCount(body);
  if (body.enabled !== undefined) patch.enabled = body.enabled === true;
  if (Array.isArray(body.scene_prompts)) patch.scene_prompts = readShotPatches(body.scene_prompts);

  const row = await patchTemplate(env.DB, id, patch);
  if (!row) throw new ApiError(404, "template_not_found");
  return Response.json({ template: toDto(row) });
}

export async function deleteTemplateRoute({ env, req, params }: Ctx): Promise<Response> {
  await requireAdmin(env, req);
  const ok = await deleteTemplate(env.DB, params.id ?? "");
  if (!ok) throw new ApiError(404, "template_not_found");
  return Response.json({ ok: true });
}

type TemplateBody = {
  title?: unknown;
  slug?: unknown;
  description?: unknown;
  age_band?: unknown;
  tier_default?: unknown;
  cover_key?: unknown;
  page_count?: unknown;
  enabled?: unknown;
};

function readTitle(body: TemplateBody): string {
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    throw new BadRequest("title_required");
  }
  return body.title.trim().slice(0, 120);
}

function readCoverKey(body: TemplateBody): string | null {
  if (body.cover_key === null) return null;
  if (typeof body.cover_key === "string") return body.cover_key.trim().slice(0, 200);
  return null;
}

/** Page count is clamped to the design range (5..8). */
function readPageCount(body: TemplateBody): number {
  const n = typeof body.page_count === "number" ? Math.round(body.page_count) : NaN;
  if (!Number.isFinite(n)) throw new BadRequest("page_count_invalid");
  return Math.min(8, Math.max(5, n));
}

function readShotPatches(input: unknown[]): ShotPatch[] {
  const out: ShotPatch[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const shot = raw as { index?: unknown; caption_prompt?: unknown; keyframe_prompt?: unknown };
    const index = typeof shot.index === "number" ? Math.round(shot.index) : NaN;
    if (!Number.isFinite(index) || index < 1) continue;
    const patch: ShotPatch = { index };
    if (typeof shot.caption_prompt === "string") patch.caption_prompt = shot.caption_prompt.slice(0, 400);
    if (typeof shot.keyframe_prompt === "string" || shot.keyframe_prompt === null) {
      patch.keyframe_prompt = shot.keyframe_prompt === null ? null : String(shot.keyframe_prompt).slice(0, 400);
    }
    out.push(patch);
  }
  return out;
}
