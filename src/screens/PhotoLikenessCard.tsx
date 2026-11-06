import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Btn } from '../ui';
import { CharacterEditor } from './CharacterEditor';
import type { DataApi, LookHints, SheetHints } from '../data';

/**
 * Narrow Worker-only surface this card needs. LocalApi / SupabaseApi do not
 * expose these, so the card runtime-checks and hides itself on those backends.
 */
type SheetApi = DataApi & {
  uploadPhoto?: (file: File) => Promise<{ photo_id: string }>;
  createConsent?: (parentName: string, othersConsented: boolean) => Promise<{ consent_id: string }>;
  requestCharacterSheet?: (
    photoId: string | null, consentId: string, kidId?: string, hints?: LookHints | null,
  ) => Promise<{ job_id: string }>;
  pollJob?: (
    jobId: string,
    opts?: { onTick?: (j: { progress?: number }) => void },
  ) => Promise<{ status: string; error?: string; progress?: number }>;
  characterSheet?: () => Promise<{ version: number; sheet_url: string | null; updated_at: string | null; hints: SheetHints }>;
  saveLookHints?: (hints: LookHints, kidId?: string) => Promise<{ ok: boolean; hints: SheetHints }>;
};

type Phase = 'idle' | 'picked' | 'uploading' | 'rendering' | 'ready' | 'failed';

/**
 * Error-code → child-friendly copy (design §2.5, Phase B #12). The table itself
 * lives in `data/errorCopy` so every screen shares one wording; this stays as the
 * named export the likeness card and Book reader already import.
 */
export { ERROR_COPY as LIKENESS_ERROR_COPY, errorCopy as likenessErrorCopy } from '../data/errorCopy';
// Imported for this module's own use too (a re-export does not bind locally).
import { errorCopy as likenessErrorCopy } from '../data/errorCopy';

/**
 * Mirror Make.tsx's name sanitising before consent is POSTed: strip non-letter marks,
 * collapse the DOM's maxLength gap on paste, and clamp to 40. Consent rows are a legal
 * artefact, so we never send raw input.
 */
export const sanitizeParentName = (raw: string) => raw.replace(/[^\p{L}\p{M}' -]/gu, '').trim().slice(0, 40);

/**
 * Photo → consent → upload → character_sheet → poll. Stores the consent_id (session),
 * shows a visible preview once the sheet exists (signed URL when available, honest chip
 * otherwise), and hides itself entirely on non-Worker backends so the trait avatar still works.
 */
export function PhotoLikenessCard({ kidId, kidName, onSheetReady }: { kidId: string; kidName: string; onSheetReady?: () => void }) {
  const s = useStore();
  const api = s.api as SheetApi;
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  // No stored blob (older sheet) → the honest "coming shortly" chip, not a fake image.
  const [previewMissing, setPreviewMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [parentName, setParentName] = useState('');
  const [others, setOthers] = useState(false);
  // R.3.2 avatar editor, opened from the preview once a sheet exists.
  const [editingLook, setEditingLook] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  /** Bumped on every start(); a poll from a superseded run must not touch state. */
  const runId = useRef(0);

  const hasSheet = s.hh?.character.id.startsWith('sheet:') ?? false;

  // A poll in flight must not setState after the card unmounts (navigate away mid-render).
  useEffect(() => () => { cancelled.current = true; }, []);

  // Existing sheet → fetch its signed preview once (Worker only).
  useEffect(() => {
    if (!hasSheet || !api.characterSheet) return;
    let on = true;
    api.characterSheet()
      .then(r => { if (on) { setSignedUrl(r.sheet_url); setPreviewMissing(!r.sheet_url); } })
      .catch(() => { if (on) setPreviewMissing(true); });
    return () => { on = false; };
  }, [api, hasSheet]);

  // Non-Worker backends: no card at all (keeps trait-avatar flow untouched).
  if (!api.uploadPhoto || !api.createConsent || !api.requestCharacterSheet || !api.pollJob) return null;

  /** Re-reads the sheet after an edit so the preview shows the new drawing. */
  const reloadSheet = () => {
    if (!api.characterSheet) return;
    api.characterSheet()
      .then(r => { setSignedUrl(r.sheet_url); setPreviewMissing(!r.sheet_url); })
      .catch(() => setPreviewMissing(true));
  };

  const pick = (f: File | null) => {
    setErr(null); setProgress(0);
    if (!f) { cancelled.current = true; setFile(null); setPhase(hasSheet ? 'ready' : 'idle'); return; }
    setFile(f); setPhase('picked');
  };

  const start = async () => {
    if (!file) return;
    const safeName = sanitizeParentName(parentName);
    if (!safeName) { setErr('Type your name to confirm consent.'); return; }
    cancelled.current = false;
    const myRun = ++runId.current;
    const stale = () => cancelled.current || myRun !== runId.current;
    setErr(null); setProgress(0); setPhase('uploading');
    try {
      const { photo_id } = await api.uploadPhoto!(file);
      if (stale()) return;
      const { consent_id } = await api.createConsent!(safeName, others);
      if (stale()) return;
      setPhase('rendering');
      const { job_id } = await api.requestCharacterSheet!(photo_id, consent_id);
      const job = await api.pollJob!(job_id, {
        onTick: j => { if (!stale()) setProgress(Math.max(0, Math.min(1, (j.progress ?? 0) / 100))); },
      });
      if (stale()) return;
      if (job.status === 'failed') { setErr(likenessErrorCopy(job.error ?? 'failed')); setPhase('failed'); return; }
      if (api.characterSheet) { try { const r = await api.characterSheet(); setSignedUrl(r.sheet_url); setPreviewMissing(!r.sheet_url); } catch { /* keep honest chip */ } }
      setPhase('ready');
      s.toast('✨ AI likeness ready');
      onSheetReady?.();
      await s.refresh();
    } catch (e) {
      if (stale()) return;
      const code = String((e as { code?: string })?.code ?? (e as Error)?.message ?? 'error').split(':')[0];
      setErr(likenessErrorCopy(code));
      setPhase('failed');
    }
  };

  const busy = phase === 'uploading' || phase === 'rendering';
  const showPreview = hasSheet || phase === 'ready';

  return <div className="card" data-testid="photo-likeness" style={{ marginTop: 12, textAlign: 'left' }}>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <b>🧑‍🎨 AI likeness (optional)</b>
      {showPreview && api.saveLookHints
        ? <button className="linkish" style={{ margin: 0 }} onClick={() => setEditingLook(v => !v)} aria-expanded={editingLook} data-testid="edit-look">🎨 Edit look</button>
        : <span className="cap">{showPreview ? 'ready' : 'photo → AI drawing'}</span>}
    </div>
    <p className="cap" style={{ marginTop: 4, textAlign: 'left' }}>Add one clear photo and we draw {kidName} as a storybook character. Skip it and the cartoon avatar below is used instead.</p>

    {showPreview && <div data-testid="ai-preview" style={{ marginTop: 8, position: 'relative', borderRadius: 18, overflow: 'hidden', minHeight: 150, background: 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {signedUrl
        ? <img src={signedUrl} alt={`AI drawing of ${kidName}`} style={{ width: '100%', display: 'block' }} data-testid="ai-preview-img" />
        : <div style={{ padding: 20, textAlign: 'center' }} data-testid="ai-preview-missing">
            <div style={{ fontSize: 34 }}>🖼️</div>
            <span className="chip">{previewMissing ? 'Preview coming shortly' : 'Loading drawing…'}</span>
          </div>}
    </div>}

    {showPreview && editingLook && <CharacterEditor
      kidId={kidId}
      kidName={kidName}
      onClose={() => setEditingLook(false)}
      onChanged={reloadSheet}
    />}

    {busy && <div data-testid="likeness-progress" style={{ marginTop: 10 }}>
      <b style={{ fontSize: 14 }}>{phase === 'uploading' ? 'Uploading photo…' : 'Nibbs is drawing the character…'}</b>
      <div className="rbar" style={{ marginTop: 6 }}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <small className="cap">{Math.round(progress * 100)}% · usually under a minute</small>
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <Btn kind="ghost" onClick={() => pick(null)} data-testid="cancel-likeness">Cancel</Btn>
      </div>
    </div>}

    {!busy && !showPreview && <>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo" data-testid="photo-input" style={{ display: 'none' }}
        onChange={e => pick(e.target.files?.[0] ?? null)} />
      <Btn kind="ghost" style={{ marginTop: 10 }} onClick={() => inputRef.current?.click()} data-testid="pick-photo">
        {file ? `Selected: ${file.name.slice(0, 24)}` : '📷 Choose a photo'}
      </Btn>
      {file && <>
        <input className="card field" aria-label="Your name for consent" placeholder="Your name (parent)" value={parentName} maxLength={40}
          style={{ marginTop: 10 }} onChange={e => setParentName(e.target.value)} />
        <label className="cap" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontWeight: 700 }}>
          <input type="checkbox" checked={others} onChange={e => setOthers(e.target.checked)} style={{ width: 18, height: 18 }} />
          Everyone in this photo is OK with this.
        </label>
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <Btn disabled={busy} onClick={start} data-testid="make-likeness">Make the AI drawing</Btn>
          <Btn kind="ghost" onClick={() => pick(null)}>Cancel</Btn>
        </div>
      </>}
    </>}

    {err && <p className="cap" data-testid="likeness-error" style={{ marginTop: 8, textAlign: 'left', color: 'var(--danger)' }}>{err}</p>}
    {phase === 'failed' && <Btn kind="ghost" style={{ marginTop: 8 }} onClick={() => { setErr(null); setPhase('picked'); }}>Try again</Btn>}
    {/* Backed by sweepPhotos + sweep_tmp.spec.ts ("soft-deletes a photo older than
        24h and removes its R2 object"). Still a promise about the server, not about
        any particular cron host. */}
    <p className="cap" style={{ marginTop: 8, textAlign: 'left' }} data-testid="photo-retention">Your photo is deleted within 24 hours, and straight after the drawing is made.</p>
  </div>;
}
