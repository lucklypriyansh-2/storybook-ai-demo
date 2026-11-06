export const MODELS = {
  openrouterText: "google/gemini-2.5-flash",
  openrouterImage: "google/gemini-2.5-flash-image",
  freeImage: "mock-image",
  freeText: "mock-text",
  /**
   * Motion (image→video) now runs through OpenRouter's Videos API (section H).
   * Default must be a model on the live `GET /api/v1/videos/models` list:
   * `google/gemini-omni-1.2-flash` accepts a `first_frame` image and 9:16 at a
   * short 3s duration, and is ~$0.023–0.025/s without audio (≈$0.07/clip).
   * `falI2V` is kept only as a historical label — fal is no longer a motion gate.
   */
  openrouterVideo: "google/gemini-omni-1.2-flash",
  falI2V: "fal-ai/wan-2.1/image-to-video",
} as const;
