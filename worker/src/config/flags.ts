import type { Env } from "../env";

export type Flags = {
  openrouter: boolean;
  fal: boolean;
  /**
   * Motion (image→video) availability. Since §H both images and motion bill
   * through OpenRouter, so this tracks OpenRouter — a flag alone is not enough,
   * a key must be present too. It is never derived from `fal`.
   */
  motion: boolean;
  killSwitchEnv: boolean;
  mockProviders: boolean;
};

export function isOn(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function readFlags(env: Env): Flags {
  const openrouter = isOn(env.ENABLE_OPENROUTER, false);
  return {
    openrouter,
    fal: isOn(env.ENABLE_FAL, false),
    motion: openrouter && !!env.OPENROUTER_API_KEY,
    killSwitchEnv: isOn(env.KILL_SWITCH, false),
    mockProviders: isOn(env.MOCK_PROVIDERS, false),
  };
}
