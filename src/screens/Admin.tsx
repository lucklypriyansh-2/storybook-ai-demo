import { useEffect, useState } from 'react';
import { Nibbs } from '../mascot';
import { useStore } from '../store';
import { Btn } from '../ui';
import { coverUrl } from './Catalog';
import { fill } from '../data/seed';
import { errorCopy } from '../data/errorCopy';
import type { CatalogShot, CatalogTemplate, DataApi, TemplatePreview } from '../data';

/** Per-shot edit payload sent as `scene_prompts[]` on PATCH /api/admin/templates/:id. */
type ShotPatch = { index: number; caption_prompt?: string; keyframe_prompt?: string | null };

/** A kid row as `GET /api/kids` returns it — the preview picker's options. */
type AdminKid = { id: string; display_name: string; has_sheet: boolean };

/**
 * Worker-only surface this screen needs. Like PhotoLikenessCard, it runtime-checks
 * so LocalApi / SupabaseApi never render an admin area (R.2.2, no invented credentials).
 */
type AdminApi = DataApi & {
  me?: () => Promise<{ user_id: string; is_admin: boolean }>;
  adminTemplates?: () => Promise<CatalogTemplate[]>;
  adminTemplateDetail?: (id: string) => Promise<{ template: CatalogTemplate; shots: CatalogShot[] }>;
  adminCreateTemplate?: (patch: Partial<CatalogTemplate> & { title: string }) => Promise<unknown>;
  adminUpdateTemplate?: (id: string, patch: Partial<CatalogTemplate> & { scene_prompts?: ShotPatch[] }) => Promise<unknown>;
  adminDeleteTemplate?: (id: string) => Promise<{ ok: boolean }>;
  adminTemplatePreview?: (id: string, kidId: string) => Promise<TemplatePreview>;
};

/** One editable shot in the admin editor (caption + optional keyframe prompt). */
type ShotDraft = { index: number; caption_prompt: string; keyframe_prompt: string };

type AdminMode = 'checking' | 'eligible' | 'non-admin' | 'local' | 'error';

/**
 * The gate uses the session's `is_admin` only (A-01). There is no password field:
 * admin is granted out of band by the operator via `POST /api/admin/bootstrap`.
 */
export function adminModeFor(api: DataApi, me: { is_admin: boolean } | null): AdminMode {
  const probe = api as AdminApi;
  if (!probe.me || !probe.adminTemplates || api.mode !== 'worker') return 'local';
  if (!me) return 'checking';
  return me.is_admin ? 'eligible' : 'non-admin';
}

export function Admin() {
  const s = useStore();
  const api = s.api as AdminApi;
  const [mode, setMode] = useState<AdminMode>('checking');
  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', age_band: '3-5', page_count: 6 });
  // A-03 per-shot prompt editor: one template open at a time, keyed by `index`.
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [shots, setShots] = useState<ShotDraft[]>([]);
  const [shotsLoading, setShotsLoading] = useState(false);
  // A-04 personalisation preview: template + kid → what each page would look like.
  const [kids, setKids] = useState<AdminKid[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewKid, setPreviewKid] = useState<string>('');
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    if (!api.me || api.mode !== 'worker') { setMode('local'); return; }
    let on = true;
    api.me()
      .then(me => on && setMode(adminModeFor(api, me)))
      .catch(e => { if (on) { setErr(String((e as Error)?.message ?? e)); setMode('error'); } });
    return () => { on = false; };
  }, [api]);

  // The preview picker lists this household's kids (GET /api/kids, same session).
  useEffect(() => {
    if (mode !== 'eligible') return;
    let on = true;
    (api as DataApi & { kids?: () => Promise<{ kids: AdminKid[] }> }).kids?.()
      .then(r => { if (on) setKids(r.kids ?? []); })
      .catch(() => { /* the picker just stays empty; no invented names */ });
    return () => { on = false; };
  }, [api, mode]);

  const openPreview = async (t: CatalogTemplate) => {
    if (!api.adminTemplatePreview) return;
    setPreviewId(t.id); setPreview(null); setPreviewErr(null);
    setEditId(null);
    // Default to the first kid; a sheet-less kid is a legitimate, explained result.
    const kidId = previewKid || kids[0]?.id || '';
    setPreviewKid(kidId);
    if (!kidId) { setPreviewErr('No kids on this account yet.'); return; }
    await runPreview(t.id, kidId);
  };

  const runPreview = async (templateId: string, kidId: string) => {
    if (!api.adminTemplatePreview) return;
    setPreviewBusy(true); setPreviewErr(null);
    try { setPreview(await api.adminTemplatePreview(templateId, kidId)); }
    catch (e) { setPreview(null); setPreviewErr(errorCopy(String((e as { code?: string })?.code ?? ''))); }
    finally { setPreviewBusy(false); }
  };

  const load = async () => {
    if (!api.adminTemplates) return;
    try { setTemplates(await api.adminTemplates()); }
    catch (e) { setErr(String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)); }
  };
  useEffect(() => { if (mode === 'eligible') load(); /* eslint-disable-next-line */ }, [mode]);

  const create = async () => {
    if (!api.adminCreateTemplate || !draft.title.trim()) return;
    setBusy(true);
    try {
      await api.adminCreateTemplate({ ...draft, title: draft.title.trim() });
      setDraft({ title: '', age_band: '3-5', page_count: 6 });
      await load();
    } catch (e) { setErr(String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const toggle = async (t: CatalogTemplate) => {
    if (!api.adminUpdateTemplate) return;
    setBusy(true);
    try { await api.adminUpdateTemplate(t.id, { enabled: !t.enabled }); await load(); }
    catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const remove = async (t: CatalogTemplate) => {
    if (!api.adminDeleteTemplate) return;
    setBusy(true);
    try { await api.adminDeleteTemplate(t.id); await load(); }
    catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  // Open the per-shot editor: load the template with its shots keyed by `index`.
  const openEditor = async (t: CatalogTemplate) => {
    if (!api.adminTemplateDetail) return;
    setErr(null); setEditId(t.id); setEditTitle(t.title); setShots([]); setShotsLoading(true);
    try {
      const detail = await api.adminTemplateDetail(t.id);
      setEditTitle(detail.template.title);
      setShots(detail.shots.map(s => ({
        index: s.index,
        caption_prompt: s.caption_prompt ?? '',
        keyframe_prompt: s.keyframe_prompt ?? '',
      })));
    } catch (e) { setErr(String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)); }
    finally { setShotsLoading(false); }
  };

  const updateShot = (index: number, patch: Partial<ShotDraft>) => {
    setShots(list => list.map(s => (s.index === index ? { ...s, ...patch } : s)));
  };

  // Save the template title + every shot prompt through one PATCH (`scene_prompts[]`).
  const saveEditor = async () => {
    if (!api.adminUpdateTemplate || !editId) return;
    setBusy(true);
    setErr(null);
    try {
      const scene_prompts: ShotPatch[] = shots.map(s => ({
        index: s.index,
        caption_prompt: s.caption_prompt.trim(),
        keyframe_prompt: s.keyframe_prompt.trim() || null,
      }));
      await api.adminUpdateTemplate(editId, { title: editTitle.trim(), scene_prompts });
      setEditId(null);
      await load();
    } catch (e) { setErr(String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  if (mode === 'checking') return <div className="body cream center" data-testid="admin-checking"><Nibbs mood="thinking" width={120} /><p className="cap">Checking access…</p></div>;

  // A non-admin (or a local build) sees only the operator-only line — never a form.
  if (mode === 'non-admin' || mode === 'local' || mode === 'error') {
    return <div className="body cream scroll" data-testid="admin-gate">
      <Nibbs mood="idle" width={140} />
      <h2>Operators only</h2>
      <p className="lead" data-testid="admin-operator-only">This area is for operators only. Admin access is granted by the server operator. There is no sign-up.</p>
      {mode === 'local' && <p className="cap">This build is on-device; the catalog lives in the cloud app.</p>}
      {mode === 'non-admin' && <p className="cap" style={{ textAlign: 'left' }} data-testid="admin-bootstrap-hint">If you are the operator: set <code>ADMIN_TOKEN</code> on the server, sign in, then POST <code>/api/admin/bootstrap</code> with header <code>X-Admin-Token</code>. There is deliberately no way to do this from here.</p>}
      {err && <p className="cap" style={{ color: 'var(--danger)' }}>{err}</p>}
      <Btn kind="ghost" onClick={() => s.go('feed')}>Back to reels</Btn>
    </div>;
  }

  return <div className="body cream scroll tabbed" data-testid="admin">
    <h1>Admin · catalog</h1>
    <p className="cap" style={{ textAlign: 'left', marginTop: 4 }}>PLACEHOLDER rows only. Titles, covers and prompts are editable sample content owned by this product.</p>
    {err && <p className="cap" data-testid="admin-error" style={{ color: 'var(--danger)' }}>{err}</p>}

    <div className="cap sect">NEW TEMPLATE</div>
    <div className="card list">
      <input className="card field" aria-label="Template title" placeholder="PLACEHOLDER story title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} data-testid="admin-title" />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <input className="card field" aria-label="Age band" value={draft.age_band} onChange={e => setDraft({ ...draft, age_band: e.target.value })} data-testid="admin-age-band" />
        <input className="card field" aria-label="Page count" type="number" min={5} max={8} value={draft.page_count} onChange={e => setDraft({ ...draft, page_count: Number(e.target.value) })} data-testid="admin-page-count" />
      </div>
      <Btn style={{ marginTop: 8 }} disabled={busy || !draft.title.trim()} onClick={create} data-testid="admin-create">Add template</Btn>
    </div>

    <div className="cap sect">TEMPLATES ({templates.length})</div>
    <div className="card list" data-testid="admin-templates">
      {templates.length === 0 && <div className="cap">No templates yet.</div>}
      {templates.map(t => {
        // #14: accessible names use the same filled, human title the row shows
        // (`fill(t.title, kidName)`), not the raw `{name}` template. The raw
        // token stays in the API body where it belongs.
        const shown = fill(t.title, s.name);
        return <div className="row" key={t.id} data-testid={`admin-row-${t.id}`}>
          <span className="img" style={{ width: 44, height: 58, borderRadius: 8, flexShrink: 0, backgroundImage: `url(${coverUrl(t.cover)})` }} />
          <div style={{ flex: 1 }}>
            <b>{shown}</b>
            <div className="cap">ages {t.age_band} · {t.page_count} pages · {t.enabled ? 'live' : 'hidden'}</div>
          </div>
          <button className="linkish" style={{ margin: 0 }} disabled={busy} onClick={() => toggle(t)} aria-label={`${t.enabled ? 'Disable' : 'Enable'} ${shown}`}>{t.enabled ? 'Disable' : 'Enable'}</button>
          <button className="linkish" style={{ margin: 0 }} disabled={busy} onClick={() => remove(t)} aria-label={`Delete ${shown}`}>Delete</button>
          {api.adminTemplateDetail && <button className="linkish" style={{ margin: 0 }} disabled={busy} onClick={() => openEditor(t)} aria-label={`Edit prompts for ${shown}`} data-testid={`admin-edit-${t.id}`}>Edit prompts</button>}
          {api.adminTemplatePreview && <button className="linkish" style={{ margin: 0 }} disabled={busy} onClick={() => openPreview(t)} aria-label={`Preview personalisation for ${shown}`} data-testid={`admin-preview-${t.id}`}>Preview</button>}
        </div>;
      })}
    </div>

    {editId && <div className="card" style={{ marginTop: 14 }} data-testid="admin-shot-editor">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>A-03 · shot prompts</b>
        <button className="x" aria-label="Close prompt editor" onClick={() => setEditId(null)}>✕</button>
      </div>
      <input className="card field" aria-label="Template title" value={editTitle} onChange={e => setEditTitle(e.target.value)} data-testid="editor-title" />
      <div className="cap" style={{ textAlign: 'left', marginTop: 4 }}>Prompts fill <code>{'{name}'}</code> with the kid. Covers and titles above stay editable sample content.</div>
      {shotsLoading && <p className="cap" data-testid="editor-loading">Loading shots…</p>}
      {!shotsLoading && shots.length === 0 && <p className="cap" data-testid="editor-empty">This template has no shots yet. Add one below.</p>}
      {shots.map(shot => <div key={shot.index} style={{ marginTop: 8 }} data-testid={`editor-shot-${shot.index}`}>
        <label className="cap">Shot {shot.index} · caption</label>
        <textarea
          className="card field"
          aria-label={`Shot ${shot.index} caption prompt`}
          rows={2}
          value={shot.caption_prompt}
          onChange={e => updateShot(shot.index, { caption_prompt: e.target.value })}
          data-testid={`editor-caption-${shot.index}`}
        />
        <label className="cap">Shot {shot.index} · keyframe (optional)</label>
        <textarea
          className="card field"
          aria-label={`Shot ${shot.index} keyframe prompt`}
          rows={2}
          value={shot.keyframe_prompt}
          onChange={e => updateShot(shot.index, { keyframe_prompt: e.target.value })}
          data-testid={`editor-keyframe-${shot.index}`}
        />
      </div>)}
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <Btn kind="ghost" disabled={busy} onClick={() => setShots(list => [...list, { index: (list.at(-1)?.index ?? 0) + 1, caption_prompt: '', keyframe_prompt: '' }])} data-testid="editor-add-shot">Add shot</Btn>
        <Btn disabled={busy || !editTitle.trim()} onClick={saveEditor} data-testid="editor-save">Save prompts</Btn>
      </div>
    </div>}

    {previewId && <div className="card" style={{ marginTop: 14 }} data-testid="admin-preview">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>A-04 · personalisation preview</b>
        <button className="x" aria-label="Close personalisation preview" onClick={() => { setPreviewId(null); setPreview(null); }}>✕</button>
      </div>
      <p className="cap" style={{ textAlign: 'left' }}>Composed from the kid's existing AI drawing over the story's placeholder art. No new images are generated for a preview, so nothing is spent.</p>

      <label className="cap" htmlFor="preview-kid">Show as</label>
      <select
        id="preview-kid"
        className="card field"
        value={previewKid}
        disabled={previewBusy}
        onChange={e => { setPreviewKid(e.target.value); void runPreview(previewId, e.target.value); }}
        data-testid="preview-kid"
      >
        {kids.length === 0 && <option value="">No kids yet</option>}
        {kids.map(k => <option key={k.id} value={k.id}>{k.display_name}{k.has_sheet ? '' : ' (no drawing yet)'}</option>)}
      </select>

      {previewBusy && <p className="cap" data-testid="preview-loading">Building preview…</p>}
      {previewErr && <p className="cap" data-testid="preview-error" style={{ color: 'var(--danger)' }}>{previewErr}</p>}

      {preview && <div data-testid="preview-shots" style={{ marginTop: 10 }}>
        <div className="cap" style={{ textAlign: 'left' }}>{preview.kid.display_name} · {preview.shots.length} pages</div>
        <div className="eplist" style={{ marginTop: 8 }}>
          {preview.shots.map(shot => <div className="card" key={shot.index} style={{ marginTop: 8, textAlign: 'left' }} data-testid={`preview-shot-${shot.index}`}>
            <div className="img" role="img" aria-label={`Page ${shot.index} preview`} style={{
              height: 120, borderRadius: 12, position: 'relative', overflow: 'hidden',
              backgroundImage: `url(${coverUrl(shot.keyframe_url)})`, backgroundSize: 'cover',
            }}>
              {/* The kid's own drawing is the overlay — never a fabricated image. */}
              {preview.overlay_url && <span className="img" style={{
                position: 'absolute', right: 8, bottom: 8, width: 56, height: 56, borderRadius: 99,
                border: '3px solid #fff', backgroundImage: `url(${preview.overlay_url})`, backgroundSize: 'cover',
              }} data-testid={`preview-overlay-${shot.index}`} />}
            </div>
            <b style={{ display: 'block', marginTop: 6 }}>Page {shot.index}</b>
            <div className="cap">{fill(shot.caption, preview.kid.display_name)}</div>
          </div>)}
        </div>
      </div>}
    </div>}

    <div style={{ height: 20 }} />
  </div>;
}
