export const PROVIDER_CAP_USD = {
  openrouter: 10.0,
  fal: 10.0,
} as const;

export const DAILY_LIMITS = {
  chars: 5,
  reels: 10,
} as const;

/** Pre-session cap on invite-code attempts, keyed by client IP. */
export const INVITE_LIMITS = { perHour: 20 } as const;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** TMP objects older than this are swept; currently 60s (NOT 24h). */
export const TMP_MAX_AGE_MS = 60_000;
/** Cadence of the in-process scheduled sweep on the portable Node build. */
export const SWEEP_INTERVAL_MS = 60_000;
/** Cap on a page-override save so a client cannot store a novel. */
export const MAX_PAGE_TEXT = 400;
export const MIN_PHOTO_BYTES = 2 * 1024; // Google image models reject tiny/placeholder images
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_MIME_ALLOWLIST = ["image/jpeg", "image/png", "image/webp"] as const;

export function capFor(provider: string): number | undefined {
  return provider in PROVIDER_CAP_USD
    ? PROVIDER_CAP_USD[provider as keyof typeof PROVIDER_CAP_USD]
    : undefined;
}
