import { all, first } from "../storage/d1";
import { uuid } from "../util/uuid";

/**
 * Catalog storage (R.1.2). Templates are admin-curated rows; every string a
 * human wrote here is PLACEHOLDER sample content owned by this product.
 * `index` is a SQL keyword and must stay double-quoted.
 */
export type TemplateRow = {
  id: string;
  slug: string;
  title: string;
  cover_key: string | null;
  description: string | null;
  age_band: string;
  tier_default: string;
  page_count: number;
  enabled: number;
  created_at: number;
  updated_at: number;
};

export type ShotRow = {
  template_id: string;
  index: number;
  caption_prompt: string;
  keyframe_prompt: string | null;
};

/** The shape the SPA/route serialises. `id` doubles as the catalog key. */
export type TemplateDto = {
  id: string;
  slug: string;
  title: string;
  cover_key: string | null;
  description: string;
  age_band: string;
  tier_default: string;
  page_count: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type ShotDto = { index: number; caption_prompt: string; keyframe_prompt: string | null };

export function toDto(row: TemplateRow): TemplateDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    cover_key: row.cover_key,
    description: row.description ?? "",
    age_band: row.age_band,
    tier_default: row.tier_default,
    page_count: row.page_count,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const COLUMNS =
  'id, slug, title, cover_key, description, age_band, tier_default, page_count, enabled, created_at, updated_at';

export async function listTemplates(
  db: D1Database,
  opts: { enabledOnly?: boolean } = {},
): Promise<TemplateRow[]> {
  const where = opts.enabledOnly ? "WHERE enabled = 1" : "";
  return all<TemplateRow>(
    db,
    `SELECT ${COLUMNS} FROM story_templates ${where} ORDER BY created_at, id`,
  );
}

export async function getTemplate(db: D1Database, id: string): Promise<TemplateRow | null> {
  return first<TemplateRow>(db, `SELECT ${COLUMNS} FROM story_templates WHERE id = ?`, id);
}

export async function getTemplateBySlug(db: D1Database, slug: string): Promise<TemplateRow | null> {
  return first<TemplateRow>(db, `SELECT ${COLUMNS} FROM story_templates WHERE slug = ?`, slug);
}

export async function getShots(db: D1Database, templateId: string): Promise<ShotRow[]> {
  return all<ShotRow>(
    db,
    'SELECT template_id, "index", caption_prompt, keyframe_prompt FROM story_template_shots WHERE template_id = ? ORDER BY "index"',
    templateId,
  );
}

export function toShotDto(row: ShotRow): ShotDto {
  return { index: row.index, caption_prompt: row.caption_prompt, keyframe_prompt: row.keyframe_prompt };
}

export type TemplateInput = {
  title: string;
  slug: string;
  cover_key?: string | null;
  description?: string | null;
  age_band?: string;
  tier_default?: string;
  page_count?: number;
  enabled?: boolean;
};

/** Slug falling back to a deterministic id seed when the admin omits it. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "story"
  );
}

export async function createTemplate(
  db: D1Database,
  input: TemplateInput,
  now = Date.now(),
): Promise<TemplateRow> {
  const id = `tpl_${uuid().replace(/-/g, "").slice(0, 12)}`;
  await db
    .prepare(
      `INSERT INTO story_templates (id, slug, title, cover_key, description, age_band, tier_default, page_count, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.slug,
      input.title,
      input.cover_key ?? null,
      input.description ?? null,
      input.age_band ?? "3-5",
      input.tier_default ?? "free",
      input.page_count ?? 6,
      input.enabled === false ? 0 : 1,
      now,
      now,
    )
    .run();
  const row = await getTemplate(db, id);
  if (!row) throw new Error("template_insert_failed");
  return row;
}

export type TemplatePatch = Partial<TemplateInput> & { scene_prompts?: ShotPatch[] };

export type ShotPatch = { index: number; caption_prompt?: string; keyframe_prompt?: string | null };

/**
 * Applies a partial update plus optional per-shot prompt edits in one batch.
 * Only keys actually present are written (a PATCH must not blank fields).
 */
export async function patchTemplate(
  db: D1Database,
  id: string,
  patch: TemplatePatch,
  now = Date.now(),
): Promise<TemplateRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  if (patch.title !== undefined) push("title", patch.title);
  if (patch.slug !== undefined) push("slug", patch.slug);
  if (patch.cover_key !== undefined) push("cover_key", patch.cover_key);
  if (patch.description !== undefined) push("description", patch.description);
  if (patch.age_band !== undefined) push("age_band", patch.age_band);
  if (patch.tier_default !== undefined) push("tier_default", patch.tier_default);
  if (patch.page_count !== undefined) push("page_count", patch.page_count);
  if (patch.enabled !== undefined) push("enabled", patch.enabled ? 1 : 0);

  const statements = [];
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    binds.push(now, id);
    statements.push(
      db.prepare(`UPDATE story_templates SET ${sets.join(", ")} WHERE id = ?`).bind(...binds),
    );
  } else if (patch.scene_prompts && patch.scene_prompts.length > 0) {
    // Prompt-only edit must still bump updated_at.
    statements.push(
      db.prepare("UPDATE story_templates SET updated_at = ? WHERE id = ?").bind(now, id),
    );
  }

  for (const shot of patch.scene_prompts ?? []) {
    const hasCaption = shot.caption_prompt !== undefined;
    const hasKeyframe = shot.keyframe_prompt !== undefined;
    if (!hasCaption && !hasKeyframe) continue;

    // caption_prompt is NOT NULL, so a keyframe-only insert seeds '' and the
    // conflict clause only overwrites the column actually sent.
    const caption = hasCaption ? shot.caption_prompt! : "";
    const keyframe = hasKeyframe ? shot.keyframe_prompt ?? null : null;
    const updates: string[] = [];
    if (hasCaption) updates.push("caption_prompt = excluded.caption_prompt");
    if (hasKeyframe) updates.push("keyframe_prompt = excluded.keyframe_prompt");
    statements.push(
      db
        .prepare(
          `INSERT INTO story_template_shots (template_id, "index", caption_prompt, keyframe_prompt)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(template_id, "index") DO UPDATE SET ${updates.join(", ")}`,
        )
        .bind(id, shot.index, caption, keyframe),
    );
  }

  if (statements.length === 0) return getTemplate(db, id);
  await db.batch(statements);
  return getTemplate(db, id);
}

export async function deleteTemplate(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM story_templates WHERE id = ?").bind(id).run();
  await db.prepare("DELETE FROM story_template_shots WHERE template_id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
