import { COSTS } from "../config/costs";
import { MODELS } from "../config/models";
import { utcDay } from "../util/day";
import type { ImageGen, ImageOpts, TextGen, TextOpts } from "./types";

type AiRunner = { run(model: string, inputs: unknown): Promise<unknown> };

async function bumpNeuronBucket(db: D1Database, now: number): Promise<void> {
  const key = `wai:global:${utcDay(now)}`;
  await db
    .prepare(
      "INSERT INTO rate_buckets (key, tokens, updated_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET tokens = tokens + 1, updated_at = excluded.updated_at",
    )
    .bind(key, now)
    .run();
}

export function makeWorkersAiText(ai: Ai, db: D1Database): TextGen {
  const runner = ai as unknown as AiRunner;
  return {
    id: "wai-llama-3.1-8b",
    estUsd: () => COSTS.shot_list_free.usd,
    async complete(opts: TextOpts) {
      const messages = [
        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: opts.prompt },
      ];
      const raw = (await runner.run(MODELS.workersAiText, { messages })) as { response?: string };
      await bumpNeuronBucket(db, Date.now());
      return { value: { text: raw.response ?? "" }, actualUsd: 0 };
    },
  };
}

export function makeWorkersAiImage(ai: Ai, db: D1Database): ImageGen {
  const runner = ai as unknown as AiRunner;
  return {
    id: "wai-flux-1-schnell",
    estUsd: (_opts: ImageOpts) => COSTS.keyframe_free.usd,
    async generate(opts: ImageOpts) {
      const raw = (await runner.run(MODELS.workersAiImage, { prompt: opts.prompt })) as {
        image?: string;
      };
      if (!raw.image) throw new Error("workers_ai_no_image");
      const bytes = Uint8Array.from(atob(raw.image), (c) => c.charCodeAt(0));
      await bumpNeuronBucket(db, Date.now());
      return { value: { bytes, mime: "image/png" }, actualUsd: 0 };
    },
  };
}
