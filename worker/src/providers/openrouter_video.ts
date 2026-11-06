import { COSTS, motionUsd } from "../config/costs";
import { MODELS } from "../config/models";
import type { FetchLike } from "./openrouter";
import type { VideoGen, VideoOpts } from "./types";

/**
 * OpenRouter Videos API (section H). Replaces the fal i2v gate: one key
 * (`OPENROUTER_API_KEY`) now covers both images and motion.
 *
 *   POST /api/v1/videos            → { id }            (queue an i2v job)
 *   GET  /api/v1/videos/{id}       → { status, … }     (poll)
 *   GET  /api/v1/videos/{id}/content → video bytes     (download)
 *
 * The default model is `google/gemini-omni-1.2-flash` (present on the live
 * `GET /api/v1/videos/models` list) at 3s / 9:16 / no audio: the cheapest
 * combination that still accepts a `first_frame` image (~$0.07/clip).
 */
const VIDEO_BASE = "https://openrouter.ai/api/v1/videos";
const REFERER = "https://lucklypriyansh-2.github.io/storybook-ai-demo";

/** Ceiling on a single render; the model is slow but a job must not hang forever. */
const POLL_TIMEOUT_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 5_000;

export const DEFAULT_ASPECT_RATIO = "9:16";

/** Refuse anything that is not a sheet/reel key before any network call (§5). */
export function assertSafeVideoInput(key: string): void {
  if (!(key.startsWith("sheets/") || key.startsWith("reels/"))) {
    throw new Error(`unsafe_video_input_key:${key.split("/")[0] ?? "empty"}`);
  }
}

/** Turns an R2 key into an absolute URL the provider can fetch (H-8). */
export type SignImageUrl = (key: string) => Promise<string>;

export type VideoJob = {
  id?: string;
  status?: string;
  /** Present once the render succeeds; the content endpoint is preferred. */
  unsigned_urls?: string[];
  error?: string | { message?: string };
  generation_id?: string;
};

/** Video treatment of an input image: a URL plus which frame it pins. */
export type FrameImage = {
  type: "image_url";
  image_url: { url: string };
  frame_type: "first_frame" | "last_frame";
};

export function buildVideoBody(
  model: string,
  imageUrl: string,
  opts: VideoOpts,
): Record<string, unknown> {
  const frames: FrameImage[] = [
    { type: "image_url", image_url: { url: imageUrl }, frame_type: "first_frame" },
  ];
  return {
    model,
    prompt: opts.prompt ?? "",
    duration: opts.seconds,
    aspect_ratio: DEFAULT_ASPECT_RATIO,
    // No audio (cost + the reel adds its own), and no silent fallbacks that
    // would swap in a pricier model behind our back (ZDR policy, §5).
    generate_audio: false,
    frame_images: frames,
    provider: { data_collection: "deny", allow_fallbacks: false },
  };
}

function detailFrom(body: VideoJob | undefined): string {
  if (!body) return "";
  const raw = typeof body.error === "string" ? body.error : body.error?.message ?? "";
  return raw.replace(/\s+/g, " ").slice(0, 160);
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const raw = typeof body.error === "string" ? body.error : body.error?.message ?? "";
    return raw ? `:${raw.replace(/\s+/g, " ").slice(0, 160)}` : "";
  } catch {
    return "";
  }
}

/** A completed job is done; anything unrecognised keeps polling until the deadline. */
function isTerminalFailure(body: VideoJob): boolean {
  return body.status === "failed" || body.status === "error" || body.status === "cancelled";
}

function isComplete(body: VideoJob): boolean {
  return body.status === "completed" || body.status === "succeeded" || body.status === "done";
}

export function makeOpenRouterVideo(
  apiKey: string,
  signImageUrl: SignImageUrl,
  fetchImpl: FetchLike = fetch,
  opts: { pollIntervalMs?: number; timeoutMs?: number } = {},
): VideoGen {
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": REFERER,
    "X-Title": "storybook-ai-demo",
  };

  return {
    id: "openrouter-gemini-omni-1.2-flash-i2v",
    estUsd: (o) => motionUsd(o.seconds),
    async i2v(o: VideoOpts) {
      assertSafeVideoInput(o.imageKey);
      const imageUrl = await signImageUrl(o.imageKey);
      if (!imageUrl.startsWith("https://")) throw new Error("unsigned_image_url");

      const submit = await fetchImpl(VIDEO_BASE, {
        method: "POST",
        headers,
        body: JSON.stringify(buildVideoBody(MODELS.openrouterVideo, imageUrl, o)),
      });
      if (!submit.ok) throw new Error(`openrouter_video_submit_http_${submit.status}${await errorDetail(submit)}`);
      const created = (await submit.json()) as VideoJob;
      const jobId = created.id ?? created.generation_id;
      if (!jobId) throw new Error("openrouter_video_no_job_id");

      const statusUrl = `${VIDEO_BASE}/${encodeURIComponent(jobId)}`;
      const deadline = Date.now() + timeoutMs;
      let job: VideoJob = created;
      for (;;) {
        if (isComplete(job)) break;
        if (isTerminalFailure(job)) {
          throw new Error(`openrouter_video_failed${detailFrom(job) ? `:${detailFrom(job)}` : ""}`);
        }
        if (Date.now() > deadline) throw new Error("openrouter_video_timeout");

        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const res = await fetchImpl(statusUrl, { headers });
        if (!res.ok) throw new Error(`openrouter_video_status_http_${res.status}${await errorDetail(res)}`);
        job = (await res.json()) as VideoJob;
      }

      // Prefer the documented content endpoint; fall back to an unsigned URL only
      // if the job carries one. Never fabricate bytes — a missing mp4 is an error.
      const bytes = await downloadContent(fetchImpl, headers, jobId, job);
      if (bytes.byteLength === 0) throw new Error("openrouter_video_empty_content");

      return {
        value: { bytes, seconds: o.seconds },
        actualUsd: COSTS.motion_i2v.usdPerSecond * o.seconds,
        requestId: jobId,
      };
    },
  };
}

async function downloadContent(
  fetchImpl: FetchLike,
  headers: Record<string, string>,
  jobId: string,
  job: VideoJob,
): Promise<Uint8Array> {
  const content = await fetchImpl(`${VIDEO_BASE}/${encodeURIComponent(jobId)}/content`, { headers });
  if (content.ok) return new Uint8Array(await content.arrayBuffer());
  // The content route can 404 briefly after completion; an unsigned URL is the
  // only other honest source. Both failing → the job fails, no invented bytes.
  const fallback = job.unsigned_urls?.[0];
  if (fallback) {
    const dl = await fetchImpl(fallback);
    if (dl.ok) return new Uint8Array(await dl.arrayBuffer());
    throw new Error(`openrouter_video_download_http_${dl.status}`);
  }
  throw new Error(`openrouter_video_content_http_${content.status}${await errorDetail(content)}`);
}
