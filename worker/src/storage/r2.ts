export const keys = {
  tmp: (id: string) => `tmp/${id}`,
  sheet: (kidId: string, sheetId: string) => `sheets/${kidId}/${sheetId}.png`,
  reel: (reelId: string, file: string) => `reels/${reelId}/${file}`,
};

export async function putTmp(
  r2: R2Bucket,
  id: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
  now = Date.now(),
): Promise<string> {
  const key = keys.tmp(id);
  await r2.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { uploaded_at: String(now) },
  });
  return key;
}

export async function getObject(r2: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return r2.get(key);
}

export async function deleteObject(r2: R2Bucket, key: string): Promise<void> {
  await r2.delete(key);
}

export async function deletePrefix(r2: R2Bucket, prefix: string): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const listed = await r2.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await r2.delete(listed.objects.map((o) => o.key));
      deleted += listed.objects.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
}
