import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/store';
import { Feed } from '../src/screens/Feed';
import { DEFAULT_LOOK } from '../src/mascot';
import { SETTINGS_DEFAULTS } from '../src/data/local';
import { TEMPLATES } from '../src/data/seed';
import type { Reel } from '../src/data/types';

const mk = (id: string, status: Reel['status']): Reel => ({ id, template_id: 'moon', state: { scene: 'moon', outfit: 'raincoat', co_star: 'nibbs', text: 'Hi' }, version: 1, status, video_url: null, loved: false, saved: false, created_at: '', updated_at: '' });

const hh = () => ({ id: 'k1', kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' }, character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } }, settings: { ...SETTINGS_DEFAULTS } });
function apiWith(reels: Reel[]) {
  return {
    mode: 'worker' as const,
    init: async () => hh(), household: async () => hh(), templates: async () => TEMPLATES,
    reels: async () => reels, books: async () => [], reelVersions: async () => [], jobs: async () => [],
    consents: async () => [], publishQueue: async () => [], setConsent: async () => {}, setLoved: async () => {}, setSaved: async () => {},
    updateKid: async () => {}, updateLook: async () => {}, updateSettings: async () => {}, queuePublish: async () => ({}), cancelPublish: async () => {},
    videoBlob: async () => null, onReels: () => () => {}, deleteAll: async () => {},
    createReel: async () => ({ reel_id: 'x', version: 1, job_id: 'j' }), remake: async () => ({ reel_id: 'x', version: 2, job_id: 'j' }),
  };
}
function ReadyFeed() { const s = useStore(); return s.ready && s.hh ? <Feed /> : null; }
afterEach(() => cleanup());

describe('Feed worker-aware copy (T8)', () => {
  it('shows the still-frames chip for a worker reel with no video', async () => {
    render(<StoreProvider api={apiWith([mk('r1', 'ready')]) as never}><ReadyFeed /></StoreProvider>);
    expect(await screen.findByTestId('still-frames-chip')).toHaveTextContent('Storybook mode · still frames');
  });

  it('uses cloud rendering copy on the worker backend', async () => {
    render(<StoreProvider api={apiWith([mk('r2', 'queued')]) as never}><ReadyFeed /></StoreProvider>);
    expect(await screen.findByTestId('rendering')).toHaveTextContent('drawing the scenes in the cloud');
  });

  it('keeps the on-phone copy on the local backend', async () => {
    const api = { ...apiWith([mk('r3', 'queued')]), mode: 'local' as const };
    render(<StoreProvider api={api as never}><ReadyFeed /></StoreProvider>);
    expect(await screen.findByTestId('rendering')).toHaveTextContent('filming it on this phone');
    expect(screen.queryByTestId('still-frames-chip')).not.toBeInTheDocument();
  });
});
