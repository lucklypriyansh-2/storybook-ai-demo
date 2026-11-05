import { LocalApi } from './local';
import { SupabaseApi } from './supabase';
import type { DataApi } from './types';
export * from './types';
export function makeApi(env: Record<string, string | undefined> = import.meta.env): DataApi {
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
  if (url && key && !env.VITE_FORCE_LOCAL) return new SupabaseApi(url, key);
  return new LocalApi();
}
