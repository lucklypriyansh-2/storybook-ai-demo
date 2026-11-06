import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { FFMPEG_PROBE_TTL_MS } from "./limits";

/**
 * ffmpeg availability probe (R.8 / Phase C #8, #9, F).
 *
 * Resolution order:
 *   1. `process.env.FFMPEG_PATH` (an operator override, e.g. a system package);
 *   2. the free npm-packaged binary (`ffmpeg-static`), so a host with no system
 *      ffmpeg — Hostinger reports `flags.ffmpeg:false` — can still become true;
 *   3. bare `ffmpeg` on PATH.
 *
 * The first candidate that runs wins. Never throws: a missing binary, a
 * non-Node runtime, or a timeout all resolve to `available: false`.
 * The result is cached with a TTL so a binary that appears later is picked up.
 */
export type FfmpegProbe = { available: boolean | null; version: string | null; checked: boolean };

type Result = { available: boolean; version: string | null };

let cache: { at: number; result: Result } | null = null;
let inflight: Promise<Result> | null = null;

const TIMEOUT_MS = 1500;

/** Test seam: force the packaged-binary lookup to a known value (or null to skip). */
let packagedOverride: string | null | undefined;

/**
 * Path of the npm-packaged static binary, or null when the platform is
 * unsupported / the package is absent. `ffmpeg-static` is CommonJS, so it is
 * loaded through createRequire rather than a static ESM import.
 */
export function packagedFfmpegPath(): string | null {
  if (packagedOverride !== undefined) return packagedOverride;
  try {
    const req = createRequire(import.meta.url);
    const mod = req("ffmpeg-static") as string | null;
    return typeof mod === "string" && mod.length > 0 ? mod : null;
  } catch {
    return null;
  }
}

/** The candidate paths in resolution order; empty strings are dropped. */
export function ffmpegCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  const fromEnv = env.FFMPEG_PATH;
  if (fromEnv && fromEnv.trim()) out.push(fromEnv.trim());
  const packaged = packagedFfmpegPath();
  if (packaged) out.push(packaged);
  out.push("ffmpeg");
  return out;
}

function runOne(binary: string): Promise<Result> {
  return new Promise((resolve) => {
    try {
      execFile(binary, ["-version"], { timeout: TIMEOUT_MS }, (err, stdout) => {
        if (err) {
          resolve({ available: false, version: null });
          return;
        }
        const first = String(stdout).split("\n")[0] ?? "";
        const match = first.match(/ffmpeg version (\S+)/);
        resolve({ available: true, version: match?.[1] ?? null });
      });
    } catch {
      resolve({ available: false, version: null });
    }
  });
}

async function run(env: Record<string, string | undefined>): Promise<Result> {
  for (const binary of ffmpegCandidates(env)) {
    const result = await runOne(binary);
    if (result.available) return result;
  }
  return { available: false, version: null };
}

/**
 * Detects ffmpeg at most once per TTL; concurrent callers share the one probe.
 * `probeFfmpeg()` starts a probe when the cache is cold or stale — call it from
 * a boot hook (fire-and-forget) so `/api/health` can read the cache cheaply.
 */
export async function probeFfmpeg(now = Date.now()): Promise<FfmpegProbe> {
  if (cache && now - cache.at < FFMPEG_PROBE_TTL_MS) {
    return { ...cache.result, checked: true };
  }
  if (!inflight) {
    const started = now;
    inflight = run(process.env)
      .then((result) => {
        cache = { at: started, result };
        return result;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const result = await inflight;
  return { ...result, checked: true };
}

/**
 * Kicks a probe off without waiting for it. The Node boot path calls this so the
 * first `/api/health` normally finds a warm cache instead of paying the 1.5s
 * exec timeout inline. Errors are already swallowed by run(); this never rejects.
 */
export function startFfmpegProbe(): void {
  void probeFfmpeg().catch(() => {
    /* probeFfmpeg never rejects; belt and braces */
  });
}

/**
 * Current cached value without triggering a probe (`null` = never checked or
 * stale). `/api/health` serialises exactly this, so it never blocks on exec and
 * never guesses: an unresolved probe stays `null` until it settles.
 */
export function cachedFfmpeg(now = Date.now()): boolean | null {
  if (!cache) return null;
  if (now - cache.at >= FFMPEG_PROBE_TTL_MS) return null;
  return cache.result.available;
}

/** Test seam: drop the memo so a probe can be re-observed. */
export function resetFfmpegCache(): void {
  cache = null;
  inflight = null;
  packagedOverride = undefined;
}

/** Test seam: pretend the packaged binary is (or is not) at `path`. */
export function setPackagedFfmpegPath(path: string | null | undefined): void {
  packagedOverride = path;
}
