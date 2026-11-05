// Minimal in-memory R2 supporting the put/get/delete/list surface used by the
// storage helpers, sweep_tmp, and the reel/motion jobs.
type StoredObject = {
  key: string;
  bytes: Uint8Array;
  customMetadata?: Record<string, string>;
  contentType?: string;
};

export class FakeR2 {
  private objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value);
    this.objects.set(key, {
      key,
      bytes,
      customMetadata: options?.customMetadata,
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async get(key: string): Promise<R2Body | null> {
    const obj = this.objects.get(key);
    return obj ? new R2Body(obj) : null;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string }): Promise<{
    objects: { key: string; customMetadata?: Record<string, string> }[];
    truncated: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix ?? "";
    const objects = [...this.objects.values()]
      .filter((o) => o.key.startsWith(prefix))
      .map((o) => ({ key: o.key, customMetadata: o.customMetadata }));
    return { objects, truncated: false };
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}

class R2Body {
  constructor(private obj: StoredObject) {}
  get customMetadata() {
    return this.obj.customMetadata;
  }
  get httpMetadata() {
    return { contentType: this.obj.contentType };
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.obj.bytes.slice().buffer;
  }
  async text(): Promise<string> {
    return new TextDecoder().decode(this.obj.bytes);
  }
  async json<T>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }
}

export function asR2(r2: FakeR2): R2Bucket {
  return r2 as unknown as R2Bucket;
}
