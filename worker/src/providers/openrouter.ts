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

type ResponsePart = {
  type?: string;
  text?: string;
  url?: string;
  image_url?: { url?: string } | string;
};

type ChatMessage = {
  content?: string | ResponsePart[];
  images?: { image_url?: { url?: string } }[];
};

type ChatResponse = {
  id?: string;
  choices?: { message?: ChatMessage }[];
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

const DATA_URL_RE = /data:image\/[^;,\s]+;base64,[A-Za-z0-9+/=]+/;

function decodeImageUrl(url: string): Uint8Array {
  // Only inline `data:image/…;base64,` payloads are safe to decode here. A bare
  // https/CDN URL would have no comma-delimited base64 body, so `atob` would
  // either throw or silently decode garbage. Reject it explicitly so the job
  // fails loudly instead of storing a corrupt sheet.
  if (!url.startsWith("data:image/")) throw new Error("openrouter_unsupported_url");
  const comma = url.indexOf(",");
  const b64 = (comma >= 0 ? url.slice(comma + 1) : url).replace(/\s+/g, "");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// OpenRouter/Gemini is inconsistent about where the image lands: a dedicated
// images[] entry, a content part, or a data URL embedded in a plain string.
function imageUrlFromContent(content: ChatMessage["content"]): string | undefined {
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || (part.type !== "image_url" && part.type !== "image")) continue;
      const url =
        typeof part.image_url === "string" ? part.image_url : part.image_url?.url ?? part.url;
      if (url) return url;
    }
    return undefined;
  }
  if (typeof content === "string") {
    const match = content.match(DATA_URL_RE);
    if (match) return match[0];
  }
  return undefined;
}

export function imageFromResponse(resp: ChatResponse): Uint8Array {
  const message = resp.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url ?? imageUrlFromContent(message?.content);
  if (!url) throw new Error("openrouter_no_image");
  return decodeImageUrl(url);
}

function textFromResponse(resp: ChatResponse): string {
  const content = resp.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" || part?.text ? part.text ?? "" : ""))
      .join("");
  }
  return "";
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
        value: { text: textFromResponse(resp) },
        actualUsd: COSTS.shot_list.usd,
        requestId: resp.id,
      };
    },
  };
}
