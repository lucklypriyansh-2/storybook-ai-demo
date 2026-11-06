import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Btn } from '../ui';
import { likenessErrorCopy } from './PhotoLikenessCard';
import { EMPTY_LOOK_HINTS, type LookHints, type SheetHints, type DataApi } from '../data';

/**
 * R.3.2 avatar editor. Three grouped, closed-vocabulary questions — appearance,
 * clothes, style — matching design-proposed/13-character-editor.html. Hints are
 * short label strings appended to the sheet prompt server-side; there is no free
 * text box, so nothing a parent types can become an instruction to the model.
 *
 * Reachable from the likeness card once a sheet exists. Three actions:
 *   Save look            → PATCH .../character_sheet/hints (free, instant);
 *   Regenerate with edits→ POST .../character_sheet with hints (+ retained photo);
 *   Cancel               → close without writing anything.
 *
 * M-14 keep/revert: because hints are stored on the character row *and* the
 * previous version is never deleted, "Cancel" leaves the stored look untouched
 * and the previous drawing is still the one served by GET — so a parent who
 * dislikes a regenerate keeps the old sheet simply by not regenerating again.
 */
type EditorApi = DataApi & {
  characterSheet?: () => Promise<{ version: number; sheet_url: string | null; updated_at: string | null; hints: SheetHints }>;
  saveLookHints?: (hints: LookHints, kidId?: string) => Promise<{ ok: boolean; hints: SheetHints }>;
  createConsent?: (parentName: string, othersConsented: boolean, kidId?: string) => Promise<{ consent_id: string }>;
  requestCharacterSheet?: (
    photoId: string | null, consentId: string, kidId?: string, hints?: LookHints | null,
  ) => Promise<{ job_id: string }>;
  pollJob?: (jobId: string, opts?: { onTick?: (j: { progress?: number }) => void }) => Promise<{ status: string; error?: string }>;
};

/** Closed vocabularies — an option is either chosen or it is not (""). */
export const APPEARANCE = [
  ['', 'As in the photo'],
  ['warm brown', 'Warm brown'],
  ['deep brown', 'Deep brown'],
  ['olive', 'Olive'],
  ['fair', 'Fair'],
] as const;
export const HAIR = [
  ['', 'As in the photo'],
  ['short curls', 'Short curls'],
  ['long braids', 'Long braids'],
  ['a bob', 'A bob'],
  ['buzz cut', 'Buzz cut'],
] as const;
export const EXTRAS = [
  ['', 'None'],
  ['wearing glasses', 'Glasses'],
  ['with freckles', 'Freckles'],
  ['glasses and freckles', 'Both'],
] as const;
export const OUTFIT = [
  ['', 'As in the photo'],
  ['a bright yellow raincoat', 'Raincoat'],
  ['an astronaut suit', 'Astronaut'],
  ['a superhero cape', 'Cape'],
  ['party clothes', 'Party'],
] as const;
export const STYLE = [
  ['', 'Soft watercolour'],
  ['bold crayon outlines', 'Bold crayon'],
  ['gentle pencil shading', 'Pencil'],
  ['bright flat colour', 'Flat colour'],
] as const;

type Group = { key: keyof LookHints; label: string; options: readonly (readonly [string, string])[] };

export const GROUPS: Group[] = [
  { key: 'skin', label: 'APPEARANCE', options: APPEARANCE },
  { key: 'hair', label: 'HAIR', options: HAIR },
  { key: 'extras', label: 'EXTRAS', options: EXTRAS },
  { key: 'outfit', label: 'CLOTHES', options: OUTFIT },
  { key: 'style', label: 'STYLE', options: STYLE },
];

/** Any hint set at all? Mirrors the Worker's `hintsOrNull` so both sides agree. */
export function hasHints(hints: LookHints): boolean {
  return GROUPS.some(g => hints[g.key].length > 0);
}

export function CharacterEditor({ kidId, kidName, onClose, onChanged }: {
  kidId: string; kidName: string; onClose: () => void; onChanged?: () => void;
}) {
  const s = useStore();
  const api = s.api as EditorApi;
  const [hints, setHints] = useState<LookHints>({ ...EMPTY_LOOK_HINTS });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  // Pre-fill from what the server actually stored — never a client-side default.
  useEffect(() => {
    const sheet = api.characterSheet;
    if (!sheet) { setLoading(false); return; }
    let on = true;
    sheet()
      .then(r => {
        if (!on) return;
        if (r.hints) setHints({ ...EMPTY_LOOK_HINTS, ...r.hints });
        setVersion(r.version);
      })
      .catch(() => { /* no sheet yet: keep the empty form */ })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [api]);

  if (!api.characterSheet || !api.requestCharacterSheet) return null;

  const set = (key: keyof LookHints, value: string) => { setHints(h => ({ ...h, [key]: value })); setNote(null); setErr(null); };

  const saveLook = async () => {
    if (!api.saveLookHints) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      await api.saveLookHints(hints, kidId);
      setNote('✓ Look saved. The drawing stays as it is until you regenerate.');
    } catch (e) {
      setErr(likenessErrorCopy(codeOf(e)));
    } finally { setBusy(false); }
  };

  const regenerate = async () => {
    if (!api.requestCharacterSheet || !api.pollJob) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      // The consent row is a legal artefact and already exists for this kid in
      // this session; a new one is created only when the session lost it.
      const { consent_id } = api.createConsent
        ? await api.createConsent(s.name || 'Parent', false, kidId)
        : { consent_id: '' };
      // photo_id omitted: the Worker reuses the retained photo. A missing one is
      // answered with photo_expired, which the copy map already explains.
      const { job_id } = await api.requestCharacterSheet(null, consent_id, kidId, hints);
      const job = await api.pollJob(job_id);
      if (job.status === 'failed') { setErr(likenessErrorCopy(job.error ?? 'error')); return; }
      if (!hasHints(hints) && api.saveLookHints) await api.saveLookHints(hints, kidId).catch(() => {});
      setNote('✨ New drawing ready.');
      onChanged?.();
      await s.refresh();
    } catch (e) {
      setErr(likenessErrorCopy(codeOf(e)));
    } finally { setBusy(false); }
  };

  return <div className="card" style={{ marginTop: 12, textAlign: 'left' }} data-testid="character-editor">
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <b>🎨 Edit {kidName}'s look</b>
      <button className="x" aria-label="Close look editor" onClick={onClose} data-testid="close-character-editor">✕</button>
    </div>
    <p className="cap" style={{ textAlign: 'left' }}>Pick a few things and we redraw the AI likeness. Nothing changes until you ask for a new drawing.</p>

    {loading && <p className="cap" data-testid="editor-loading">Loading the saved look…</p>}
    {!loading && GROUPS.map(group => <div key={group.key} style={{ marginTop: 10 }} data-testid={`hints-${group.key}`}>
      <div className="cap sect">{group.label}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {group.options.map(([value, label]) => <button
          key={value || 'none'}
          className={`card chip${hints[group.key] === value ? ' sel' : ''}`}
          aria-pressed={hints[group.key] === value}
          aria-label={`${group.label} ${label}`}
          disabled={busy}
          onClick={() => set(group.key, value)}
          data-testid={`hint-${group.key}-${value || 'none'}`}
        >{label}</button>)}
      </div>
    </div>)}

    {version !== null && <p className="cap" style={{ marginTop: 8 }} data-testid="editor-version">Drawing v{version} · edits apply to the next regenerate</p>}
    {note && <p className="cap" data-testid="editor-note" style={{ marginTop: 8 }}>{note}</p>}
    {err && <p className="cap" data-testid="editor-error" style={{ marginTop: 8, color: 'var(--danger)' }}>{err}</p>}

    <div className="row" style={{ marginTop: 10, gap: 8 }}>
      <Btn disabled={busy} onClick={regenerate} data-testid="regenerate-with-edits">{busy ? 'Drawing…' : 'Regenerate with edits'}</Btn>
      <Btn kind="ghost" disabled={busy} onClick={saveLook} data-testid="save-look">Save look only</Btn>
      <Btn kind="ghost" disabled={busy} onClick={onClose} data-testid="cancel-character-editor">Cancel</Btn>
    </div>
  </div>;
}

function codeOf(e: unknown): string {
  return String((e as { code?: string })?.code ?? (e as Error)?.message ?? 'error').split(':')[0];
}
