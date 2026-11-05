/** Tiny IndexedDB key-value store (one DB, one object store). Falls back to an in-memory Map where IndexedDB is unavailable (tests, private mode quirks). */
const DB_NAME = 'starringme', STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;
const mem = new Map<string, unknown>();
const hasIdb = () => typeof indexedDB !== 'undefined';
function open() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const q = f(t.objectStore(STORE)); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); });
}
export const kv = {
  async get<T>(k: string): Promise<T | undefined> { if (!hasIdb()) return mem.get(k) as T; try { const v = await tx<T>('readonly', s => s.get(k)); return v === undefined ? (mem.get(k) as T) : v; } catch { return mem.get(k) as T; } },
  async set(k: string, v: unknown) { if (!hasIdb()) { mem.set(k, v); return; } try { await tx('readwrite', s => s.put(v, k)); } catch { mem.set(k, v); } },
  async del(k: string) { mem.delete(k); if (hasIdb()) try { await tx('readwrite', s => s.delete(k)); } catch { /* ignore */ } },
  async keys(): Promise<string[]> { if (!hasIdb()) return [...mem.keys()]; try { return (await tx<IDBValidKey[]>('readonly', s => s.getAllKeys())).map(String); } catch { return [...mem.keys()]; } },
  async clear() { mem.clear(); if (hasIdb()) try { await tx('readwrite', s => s.clear()); } catch { /* ignore */ } },
};
