import { COSTS } from "../config/costs";
import { MODELS } from "../config/models";
import { bytesToBase64 } from "../util/hash";
import type { ImageGen, ImageOpts, TextGen, TextOpts } from "./types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REFERER = "https://lucklypriyansh-2.github.io/storybook-ai-demo";

// Every request carries this policy; it is the enforcement point for ZDR (design §5).
export const PROVIDER_POLICY = {
  data_collection: "deny",
  allow_fallbacks: false,
  require_parameters: true,
} as const;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildOpenRouterBody(
  model: string,
  messages: { role: "system" | "user"; content: string | ContentPart[] }[],
  modalities?: string[],
): Record<string, unknown> {
  return {
    model,
    messages,
    provider: { ...PROVIDER_POLICY },
    ...(modalities ? { modalities } : {}),
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type ChatResponse = {
  id?: string;
  choices?: { message?: { content?: string; images?: { image_url?: { url: string } }[] } }[];
};

async function call(
  apiKey: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<ChatResponse> {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": REFERER,
      "X-Title": "storybook-ai-demo",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const errBody = (await res.json()) as { error?: { message?: string; metadata?: { raw?: string } } };
      detail = errBody.error?.metadata?.raw || errBody.error?.message || "";
      detail = detail.replace(/\s+/g, " ").slice(0, 160);
    } catch {
      /* ignore parse failures */
    }
    throw new Error(detail ? `openrouter_http_${res.status}:${detail}` : `openrouter_http_${res.status}`);
  }
  return (await res.json()) as ChatResponse;
}

function imageFromResponse(resp: ChatResponse): Uint8Array {
  const url = resp.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("openrouter_no_image");
  const comma = url.indexOf(",");
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function makeOpenRouterImage(apiKey: string, fetchImpl: FetchLike = fetch): ImageGen {
  return {
    id: "openrouter-gemini-2.5-flash-image",
    estUsd: () => COSTS.character_sheet.usd,
    async generate(opts: ImageOpts) {
      const content: ContentPart[] = [{ type: "text", text: opts.prompt }];
      if (opts.image) {
        const url =
          "url" in opts.image
            ? opts.image.url
            : `data:${opts.image.mime};base64,${bytesToBase64(opts.image.data)}`;
        content.push({ type: "image_url", image_url: { url } });
      }
      const resp = await call(
        apiKey,
        buildOpenRouterBody(MODELS.openrouterImage, [{ role: "user", content }], ["image", "text"]),
        fetchImpl,
      );
      return {
        value: { bytes: imageFromResponse(resp), mime: "image/png" },
        actualUsd: COSTS.character_sheet.usd,
        requestId: resp.id,
      };
    },
  };
}

export function makeOpenRouterText(apiKey: string, fetchImpl: FetchLike = fetch): TextGen {
  return {
    id: "openrouter-gemini-2.5-flash",
    estUsd: () => COSTS.shot_list.usd,
    async complete(opts: TextOpts) {
      const messages: { role: "system" | "user"; content: string }[] = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });
      messages.push({ role: "user", content: opts.prompt });
      const resp = await call(
        apiKey,
        buildOpenRouterBody(MODELS.openrouterText, messages),
        fetchImpl,
      );
      return {
        value: { text: resp.choices?.[0]?.message?.content ?? "" },
        actualUsd: COSTS.shot_list.usd,
        requestId: resp.id,
      };
    },
  };
}
