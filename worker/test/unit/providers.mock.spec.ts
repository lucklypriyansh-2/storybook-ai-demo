import { describe, expect, it, vi } from "vitest";
import { assertSafeVideoInput, makeFalVideo } from "../../src/providers/fal";
import { makeProviders } from "../../src/providers";
import { buildOpenRouterBody, makeOpenRouterImage, imageFromResponse, PROVIDER_POLICY } from "../../src/providers/openrouter";
import { makeMockImage } from "../../src/providers/mock";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";

function envFrom(overrides: Partial<Env>): Env {
  return {
    DB: asD1(new FakeD1()),
    R2: {},
    JOBS: {},
    AI: {},
    WORKER_SESSION_SECRET: "test",
    ENABLE_WORKERS_AI: "0",
    ENABLE_OPENROUTER: "1",
    ENABLE_FAL: "1",
    KILL_SWITCH: "0",
    ...overrides,
  } as unknown as Env;
}

describe("openrouter adapter", () => {
  it("sets data_collection=deny, no fallbacks, required params on every body", () => {
    const body = buildOpenRouterBody("google/gemini-2.5-flash-image", [
      { role: "user", content: "hi" },
    ]);
    expect(body.provider).toEqual(PROVIDER_POLICY);
    expect(body.provider).toMatchObject({
      data_collection: "deny",
      allow_fallbacks: false,
      require_parameters: true,
    });
  });

  it("sends the ZDR policy on the wire and returns image bytes", async () => {
    const pngB64 = "iVBORw0KGgo=";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.provider.data_collection).toBe("deny");
      expect(sent.provider.allow_fallbacks).toBe(false);
      expect(sent.provider.require_parameters).toBe(true);
      return new Response(
        JSON.stringify({
          id: "req_1",
          choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${pngB64}` } }] } }],
        }),
        { status: 200 },
      );
    });

    const adapter = makeOpenRouterImage("test-key", fetchImpl);
    const out = await adapter.generate({ prompt: "a friendly fox" });
    expect(out.value.bytes.length).toBeGreaterThan(0);
    expect(out.requestId).toBe("req_1");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("extracts a data URL from a content part array", async () => {
    const pngB64 = "iVBORw0KGgo=";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.modalities).toEqual(["image", "text"]);
      return new Response(
        JSON.stringify({
          id: "req_parts",
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "here you go" },
                  { type: "image_url", image_url: { url: `data:image/png;base64,${pngB64}` } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const adapter = makeOpenRouterImage("test-key", fetchImpl);
    const out = await adapter.generate({ prompt: "a friendly fox" });
    expect(out.value.bytes).toEqual(Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0)));
    expect(out.requestId).toBe("req_parts");
  });

  it("extracts a data URL embedded in a content string", async () => {
    const pngB64 = "iVBORw0KGgo=";
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "req_string",
          choices: [
            {
              message: {
                content: `Sure! ![img](data:image/png;base64,${pngB64}) hope that helps`,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const adapter = makeOpenRouterImage("test-key", fetchImpl);
    const out = await adapter.generate({ prompt: "a friendly fox" });
    expect(out.value.bytes).toEqual(Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0)));
    expect(out.requestId).toBe("req_string");
  });

  it("throws openrouter_no_image when no image is present anywhere", () => {
    expect(() =>
      imageFromResponse({ choices: [{ message: { content: "no picture here" } }] }),
    ).toThrow("openrouter_no_image");
  });

  it("throws openrouter_unsupported_url for a non-data:image URL instead of mis-decoding it", () => {
    expect(() =>
      imageFromResponse({
        choices: [{ message: { images: [{ image_url: { url: "https://cdn.example.dev/sheet.png" } }] } }],
      }),
    ).toThrow("openrouter_unsupported_url");
    expect(() =>
      imageFromResponse({
        choices: [
          { message: { content: [{ type: "image_url", image_url: { url: "https://cdn.example.dev/x.png" } }] } },
        ],
      }),
    ).toThrow("openrouter_unsupported_url");
  });
});

// `fal.ts` is retained but no longer selected by any code path (§H moved motion
// to OpenRouter). Its tests stay so the module does not rot silently — the live
// motion adapter is covered in openrouter_video.spec.ts.
describe("fal adapter (retained, unused)", () => {
  const sign = async (key: string) => `https://api.example.dev/api/media/${key}?exp=1&sig=x`;

  it("refuses tmp/ input keys at the assertion boundary", () => {
    expect(() => assertSafeVideoInput("tmp/abc")).toThrow(/fal_unsafe_input_key/);
  });

  it("refuses tmp/ before making any network call", async () => {
    const fetchImpl = vi.fn();
    const adapter = makeFalVideo("test-key", sign, fetchImpl);
    await expect(
      adapter.i2v({ imageKey: "tmp/abc", seconds: 2.5 }),
    ).rejects.toThrow(/fal_unsafe_input_key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts sheets/ and reels/ keys", () => {
    expect(() => assertSafeVideoInput("sheets/kid/sheet.png")).not.toThrow();
    expect(() => assertSafeVideoInput("reels/r1/shot0.png")).not.toThrow();
  });

  it("sends an absolute https image_url, not a bare R2 key", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        const body = JSON.parse(String(init.body));
        expect(body.image_url).toBe(
          "https://api.example.dev/api/media/reels/r1/shot-1.png?exp=1&sig=x",
        );
        return new Response(JSON.stringify({ request_id: "req_1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "FAILED" }), { status: 200 });
    });
    const adapter = makeFalVideo("test-key", sign, fetchImpl);
    await expect(
      adapter.i2v({ imageKey: "reels/r1/shot-1.png", seconds: 2.5 }),
    ).rejects.toThrow(/fal_job_failed/);
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe("provider selection", () => {
  it("returns mocks when MOCK_PROVIDERS=1 even with flags and keys set", async () => {
    const providers = makeProviders(
      envFrom({ MOCK_PROVIDERS: "1", OPENROUTER_API_KEY: "real", FAL_KEY: "real" }),
    );
    expect(providers.mocked).toBe(true);
    expect(providers.image.id).toBe("mock-image");
    expect(providers.video.id).toBe("mock-video");
  });

  it("falls back to mocks when an enabled provider has no key", () => {
    const providers = makeProviders(envFrom({ OPENROUTER_API_KEY: undefined, FAL_KEY: undefined }));
    expect(providers.image.id).toBe("mock-image");
    expect(providers.video.id).toBe("mock-video");
  });

  it("mock image output is deterministic and non-empty", async () => {
    const a = await makeMockImage().generate({ prompt: "same prompt" });
    const b = await makeMockImage().generate({ prompt: "same prompt" });
    const c = await makeMockImage().generate({ prompt: "different prompt" });
    expect(a.value.bytes.length).toBeGreaterThan(0);
    expect([...a.value.bytes]).toEqual([...b.value.bytes]);
    expect([...a.value.bytes]).not.toEqual([...c.value.bytes]);
  });
});
