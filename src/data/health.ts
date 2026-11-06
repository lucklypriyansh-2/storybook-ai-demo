import { useEffect, useState } from 'react';
import type { DataApi } from './types';

export type HealthFlags = { openrouter: boolean; fal: boolean; motion?: boolean; kill: boolean };

/** HD/motion is off unless baked in as "true"/"1" (this milestone ships it off everywhere). */
export function hdEnabled(): boolean {
  const v = import.meta.env.VITE_HD_ENABLED;
  return v === 'true' || v === '1';
}

type HealthPayload = { flags?: { motion?: boolean; openrouter?: boolean; fal?: boolean } };

/**
 * Motion (video) is only real when both the build flag and the Worker's motion
 * availability are on. Since §H motion is billed through OpenRouter, so the
 * signal is `flags.motion` (falling back to openrouter for an older Worker that
 * predates the flag). Missing key / flag → unavailable. We never fake a video.
 */
export function useMotionAvailable(api: DataApi): { available: boolean; checked: boolean; motion: boolean } {
  const [motion, setMotion] = useState<boolean | null>(null);
  useEffect(() => {
    // Ask the Worker directly instead of guessing from the class: any backend whose mode is
    // 'worker' (real WorkerApi or a test/future implementation) reports its own flag.
    // local/supabase have no /api/health, so motion stays off there.
    const probe = api as DataApi & { health?: () => Promise<HealthPayload> };
    if (api.mode !== 'worker' || typeof probe.health !== 'function') { setMotion(false); return; }
    let on = true;
    probe.health()
      // `motion` is authoritative; `openrouter` is the pre-§H fallback. fal is
      // deliberately ignored — it never drove motion and no longer does.
      .then(h => { if (on) setMotion(!!(h.flags?.motion ?? h.flags?.openrouter)); })
      .catch(() => { if (on) setMotion(false); });
    return () => { on = false; };
  }, [api]);
  const m = motion ?? false;
  return { available: hdEnabled() && m, checked: motion !== null, motion: m };
}
