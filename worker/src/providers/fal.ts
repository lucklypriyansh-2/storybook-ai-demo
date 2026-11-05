import { COSTS, motionUsd } from "../config/costs";
import { MODELS } from "../config/models";
import type { FetchLike } from "./openrouter";
import type { VideoGen, VideoOpts } from "./types";

const QUEUE_BASE = `https://queue.fal.run/${MODELS.falI2V}`;

export function assertSafeVideoInput(key: string): void {
  if (!(key.startsWith("sheets/") || key.startsWith("reels/"))) {
    throw new Error(`fal_unsafe_input_key:${key.split("/")[0] ?? "empty"}`);
  }
}

type SubmitResponse = { request_id: string };
type StatusResponse = { status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED"; response_url?: string };
type ResultResponse = { video?: { url: string }; detail?: string };

/** Turns an R2 key into an absolute URL fal can fetch (H-8). */
export type SignImageUrl = (key: string) => Promise<string>;

export function makeFalVideo(
  apiKey: string,
  signImageUrl: SignImageUrl,
  fetchImpl: FetchLike = fetch,
): VideoGen {
  const auth = { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" };

  return {
    id: "fal-wan-2.1-i2v",
    estUsd: (opts) => motionUsd(opts.seconds),
    async i2v(opts: VideoOpts) {
      assertSafeVideoInput(opts.imageKey);
      const imageUrl = await signImageUrl(opts.imageKey);
      if (!imageUrl.startsWith("https://")) throw new Error("fal_unsigned_image_url");

      const submit = await fetchImpl(QUEUE_BASE, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: opts.prompt ?? "",
          duration: String(opts.seconds),
        }),
      });
      if (!submit.ok) throw new Error(`fal_submit_http_${submit.status}`);
      const { request_id } = (await submit.json()) as SubmitResponse;

      const statusUrl = `${QUEUE_BASE}/requests/${request_id}/status`;
      const deadline = Date.now() + 10 * 60_000;
      for (;;) {
        const res = await fetchImpl(statusUrl, { headers: auth });
        if (!res.ok) throw new Error(`fal_status_http_${res.status}`);
        const status = (await res.json()) as StatusResponse;
        if (status.status === "COMPLETED") {
          const resultUrl = status.response_url ?? `${QUEUE_BASE}/requests/${request_id}`;
          const out = await fetchImpl(resultUrl, { headers: auth });
          if (!out.ok) throw new Error(`fal_result_http_${out.status}`);
          const result = (await out.json()) as ResultResponse;
          if (!result.video?.url) throw new Error("fal_no_video");
          const video = await fetchImpl(result.video.url);
          if (!video.ok) throw new Error(`fal_download_http_${video.status}`);
          return {
            value: { bytes: new Uint8Array(await video.arrayBuffer()), seconds: opts.seconds },
            actualUsd: COSTS.motion_i2v.usdPerSecond * opts.seconds,
            requestId: request_id,
          };
        }
        if (status.status === "FAILED") throw new Error("fal_job_failed");
        if (Date.now() > deadline) throw new Error("fal_timeout");
        await new Promise((r) => setTimeout(r, 2_000));
      }
    },
  };
}
