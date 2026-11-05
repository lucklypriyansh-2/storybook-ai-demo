import type { Env } from "../env";

export type Flags = {
  workersAi: boolean;
  openrouter: boolean;
  fal: boolean;
  killSwitchEnv: boolean;
  mockProviders: boolean;
};

export function isOn(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function readFlags(env: Env): Flags {
  return {
    workersAi: isOn(env.ENABLE_WORKERS_AI, true),
    openrouter: isOn(env.ENABLE_OPENROUTER, false),
    fal: isOn(env.ENABLE_FAL, false),
    killSwitchEnv: isOn(env.KILL_SWITCH, false),
    mockProviders: isOn(env.MOCK_PROVIDERS, false),
  };
}
