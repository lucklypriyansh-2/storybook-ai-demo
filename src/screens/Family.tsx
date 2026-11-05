import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Btn, Sheet } from '../ui';
import type { Reel } from '../data';

/** Behind the parent gate: save/share the real video file, and queue an Instagram DRAFT (never posts). */
export function FamilySheet({ reel, onClose }: { reel: Reel; onClose: () => void }) {
  const s = useStore();
  const [caption, setCaption] = useState(`A tiny adventure starring Nibbs ✨ Made with Starring Me. #AIgenerated`);
  const [queued, setQueued] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { (async () => {
    const u = await s.videoSrc(reel.video_url); if (!u) return;
    const b = await (await fetch(u)).blob(); const ext = b.type.includes('mp4') ? 'mp4' : 'webm';
    setFile(new File([b], `starring-me-${reel.template_id}-v${reel.version}.${ext}`, { type: b.type }));
  })().catch(() => {}); }, [reel.video_url]);
  const share = async () => {
    if (!file) return;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: s.title(reel) }); return; } catch { /* cancelled */ return; } }
    const u = URL.createObjectURL(file); const a = document.createElement('a'); a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500);
    s.toast('⬇️ Video downloaded');
  };
  const publish = async () => {
    const p = await s.api.queuePublish(reel.id, caption); await s.refresh();
    setQueued(p.id); s.toast('📥 Instagram draft queued. Nothing was posted.');
  };
  return <Sheet label="Family and sharing" onClose={onClose}>
    <h2 style={{ textAlign: 'left' }}>Share {s.title(reel)}</h2>
    <p className="cap" style={{ textAlign: 'left', marginTop: 4 }}>Grown-ups only · version {reel.version} · {file ? `${(file.size / 1024).toFixed(0)} KB ${file.type.split('/')[1].toUpperCase()}` : reel.status === 'ready' ? 'loading video…' : 'still rendering'}</p>
    <Btn style={{ marginTop: 14 }} disabled={!file} onClick={share} data-testid="share-file">📲 Save to phone / Share</Btn>
    <div className="card" style={{ marginTop: 16, textAlign: 'left' }}>
      <b>Publish to Instagram</b>
      <div className="cap" style={{ marginTop: 4 }}>Creates a draft only. Posting needs the Instagram connection (pending Meta login) and your OK for each post.</div>
      <textarea aria-label="Instagram caption" className="field cap-in" rows={3} maxLength={2200} value={caption} onChange={e => setCaption(e.target.value)} />
      {queued ? <p className="okline" data-testid="draft-ok">✓ Draft queued · status: draft · not posted</p>
        : <Btn kind="indigo" style={{ marginTop: 10 }} disabled={reel.status !== 'ready'} onClick={publish} data-testid="publish">Publish (queue draft)</Btn>}
    </div>
    <Btn kind="ghost" style={{ marginTop: 12 }} onClick={onClose}>Done</Btn>
  </Sheet>;
}
