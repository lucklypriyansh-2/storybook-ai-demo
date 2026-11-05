import { useEffect, useState } from 'react';
import type { DataApi } from './types';

export type HealthFlags = { openrouter: boolean; fal: boolean; kill: boolean };

/** HD/motion is off unless baked in as "true"/"1" (this milestone ships it off everywhere). */
export function hdEnabled(): boolean {
  const v = import.meta.env.VITE_HD_ENABLED;
  return v === 'true' || v === '1';
}

/**
 * Motion (video) is only real when both the build flag and the Worker's `fal`
 * flag are on. Missing key / flag → unavailable. We never fake a video.
 */
export function useMotionAvailable(api: DataApi): { available: boolean; checked: boolean; fal: boolean } {
  const [fal, setFal] = useState<boolean | null>(null);
  useEffect(() => {
    // Ask the Worker directly instead of guessing from the class: any backend whose mode is
    // 'worker' (real WorkerApi or a test/future implementation) reports its own fal flag.
    // local/supabase have no /api/health, so motion stays off there.
    const probe = api as DataApi & { health?: () => Promise<{ flags?: { fal?: boolean } }> };
    if (api.mode !== 'worker' || typeof probe.health !== 'function') { setFal(false); return; }
    let on = true;
    probe.health()
      .then(h => { if (on) setFal(!!h.flags?.fal); })
      .catch(() => { if (on) setFal(false); });
    return () => { on = false; };
  }, [api]);
  const f = fal ?? false;
  return { available: hdEnabled() && f, checked: fal !== null, fal: f };
}
