import { sha256Hex } from "../util/hash";
import type { ImageGen, ImageOpts, TextGen, TextOpts, VideoGen, VideoOpts } from "./types";

// Deterministic 1x1 PNG-sized marker: same bytes for the same prompt hash.
async function fixtureBytes(label: string): Promise<Uint8Array> {
  const digest = await sha256Hex(label);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(digest.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function makeMockImage(): ImageGen {
  return {
    id: "mock-image",
    estUsd: () => 0,
    async generate(opts: ImageOpts) {
      return { value: { bytes: await fixtureBytes(opts.prompt), mime: "image/png" }, actualUsd: 0 };
    },
  };
}

export function makeMockText(): TextGen {
  return {
    id: "mock-text",
    estUsd: () => 0,
    async complete(opts: TextOpts) {
      return {
        value: { text: JSON.stringify({ shots: [], prompt_hash: await sha256Hex(opts.prompt) }) },
        actualUsd: 0,
      };
    },
  };
}

export function makeMockVideo(): VideoGen {
  return {
    id: "mock-video",
    estUsd: () => 0,
    async i2v(opts: VideoOpts) {
      return {
        value: { bytes: await fixtureBytes(opts.imageKey + opts.prompt), seconds: opts.seconds },
        actualUsd: 0,
      };
    },
  };
}
