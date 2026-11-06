export type ImageInput = { data: Uint8Array; mime: string };

export type ImageOpts = {
  prompt: string;
  image?: ImageInput | { url: string };
  count?: number;
};

export type TextOpts = {
  system?: string;
  prompt: string;
  json?: boolean;
};

export type VideoOpts = {
  imageKey: string;
  prompt?: string;
  seconds: number;
};

export type GenResult<T> = { value: T; actualUsd?: number; requestId?: string };

export type ImageGen = {
  id: "openrouter-gemini-2.5-flash-image" | "mock-image";
  estUsd(opts: ImageOpts): number;
  generate(opts: ImageOpts): Promise<GenResult<{ bytes: Uint8Array; mime: string }>>;
};

export type TextGen = {
  id: "openrouter-gemini-2.5-flash" | "mock-text";
  estUsd(opts: TextOpts): number;
  complete(opts: TextOpts): Promise<GenResult<{ text: string }>>;
};

export type VideoGen = {
  id: "openrouter-gemini-omni-1.2-flash-i2v" | "fal-wan-2.1-i2v" | "mock-video";
  estUsd(opts: VideoOpts): number;
  i2v(opts: VideoOpts): Promise<GenResult<{ bytes: Uint8Array; seconds: number }>>;
};
