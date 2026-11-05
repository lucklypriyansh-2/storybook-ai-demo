import { LocalApi } from './local';
import { SupabaseApi } from './supabase';
import { WorkerApi } from './worker';
import type { DataApi } from './types';
export * from './types';
export { WorkerApi, WorkerError } from './worker';
/** Priority: Cloudflare Worker (VITE_API_URL) > Supabase > on-device LocalApi. */
export function makeApi(env: Record<string, string | undefined> = import.meta.env): DataApi {
  const apiUrl = env.VITE_API_URL;
  if (apiUrl && !env.VITE_FORCE_LOCAL) return new WorkerApi(apiUrl.replace(/\/$/, ''));
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
  if (url && key && !env.VITE_FORCE_LOCAL) return new SupabaseApi(url, key);
  return new LocalApi();
}
