import { execFile } from "node:child_process";

/**
 * ffmpeg availability probe (R.8). Cached for the process lifetime:
 * `null` until checked, then a boolean. Never throws — a missing binary, a
 * non-Node runtime, or a timeout all resolve to `false` with `checked: true`.
 */
export type FfmpegProbe = { available: boolean | null; version: string | null; checked: boolean };

let cache: { available: boolean; version: string | null } | null = null;
let inflight: Promise<{ available: boolean; version: string | null }> | null = null;

const TIMEOUT_MS = 1500;

function run(): Promise<{ available: boolean; version: string | null }> {
  return new Promise((resolve) => {
    try {
      execFile("ffmpeg", ["-version"], { timeout: TIMEOUT_MS }, (err, stdout) => {
        if (err) return resolve({ available: false, version: null });
        const first = String(stdout).split("\n")[0] ?? "";
        const match = first.match(/ffmpeg version (\S+)/);
        resolve({ available: true, version: match?.[1] ?? null });
      });
    } catch {
      resolve({ available: false, version: null });
    }
  });
}

/** Detects ffmpeg once per process; concurrent callers share the one probe. */
export async function probeFfmpeg(): Promise<FfmpegProbe> {
  if (cache) return { ...cache, checked: true };
  if (!inflight) {
    inflight = run().then((result) => {
      cache = result;
      return result;
    });
  }
  const result = await inflight;
  return { ...result, checked: true };
}

/** Current cached value without triggering a probe (`null` = not yet checked). */
export function cachedFfmpeg(): boolean | null {
  return cache ? cache.available : null;
}

/** Test seam: drop the memo so a probe can be re-observed. */
export function resetFfmpegCache(): void {
  cache = null;
  inflight = null;
}
