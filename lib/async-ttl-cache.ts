/** Bounded completed values plus shared pending loads. Never caches failures. */
export function createAsyncTtlCache<T>(ttlMs: number, maxEntries: number, now = Date.now) {
  const values = new Map<string, { value: T; expiresAt: number }>();
  const pending = new Map<string, Promise<T>>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const cached = values.get(key);
      if (cached && cached.expiresAt > now()) return Promise.resolve(cached.value);
      values.delete(key);
      const existing = pending.get(key);
      if (existing) return existing;
      const promise = Promise.resolve().then(load).then((value) => {
        values.set(key, { value, expiresAt: now() + ttlMs });
        while (values.size > maxEntries) values.delete(values.keys().next().value!);
        return value;
      }).finally(() => { pending.delete(key); });
      pending.set(key, promise);
      return promise;
    },
  };
}
