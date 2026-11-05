import { img } from '../motion';
import { useStore } from '../store';
import { sceneOf } from '../data/seed';

export function Shelf() {
  const s = useStore();
  const saved = s.reels.filter(r => r.saved);
  return <div className="body cream scroll tabbed" data-testid="shelf">
    <h1>{s.name}'s shelf</h1>
    <div className="card" style={{ marginTop: 10, background: 'var(--teal1)', borderColor: '#B5ECE5', boxShadow: '0 4px 0 #B5ECE5' }}><b>📚 {Math.min(saved.length, 6)} of 6 saved reels</b><div className="cap">6 saved reels = a keepsake book</div>
      <div className="progress" style={{ marginTop: 8, height: 12 }}><i style={{ width: `${Math.min(100, (saved.length / 6) * 100)}%` }} /></div></div>
    <div className="cap sect">SAVED REELS</div>
    {saved.length === 0 ? <p className="cap">Tap Save on a reel to keep it here.</p> :
      <div className="grid3">{saved.map(r => <button key={r.id} className="tile2 tall" style={{ backgroundImage: `url(${img(sceneOf(r.state.scene).image)})` }} onClick={() => s.go('feed')}><span>{s.title(r)}</span></button>)}</div>}
    <div className="cap sect">BOOKS</div>
    <div className="grid2">{s.books.map(b => { const r = s.reels.find(r => r.id === b.reel_id); const t = r && s.tpl(r.template_id);
      return <button key={b.id} className="book" onClick={() => s.go('book', b.id)}><div className="img" style={{ aspectRatio: '3/4', borderRadius: '6px 16px 16px 6px', backgroundImage: `url(${img(t?.cover ?? 'cover.jpg')})`, boxShadow: '0 5px 0 var(--line),inset 6px 0 0 rgba(0,0,0,.14)' }} /><b style={{ display: 'block', marginTop: 6, fontSize: 14 }}>{b.title}</b><span className="cap">{b.pages.length} pages</span></button>; })}</div>
    <div style={{ height: 20 }} />
  </div>;
}
