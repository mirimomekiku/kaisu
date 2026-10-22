// Fetching pictures through Kaisu (the page may not load them itself) and showing them from memory. Keeps a few requests in
// flight at a time and remembers what it has fetched. Thumbnails and album covers both use it.

export interface ImageLoader {
  /** What is known without fetching: a picture address, null if it failed lately, or undefined if nobody has asked yet. */
  peek(key: string): string | null | undefined;
  /** The picture for `key` as something an `<img>` can show, or null if it can't be loaded. */
  load(key: string): Promise<string | null>;
  invalidate?: (keys: string[]) => void;
  subscribe?: (listener: () => void) => () => void;
}

interface Options {
  /** Keys that need no fetching (they are already addresses the page can show). */
  isLocal?: (key: string) => boolean;
  maxParallel?: number;
  maxCached?: number;
  retryAfterMs?: number;
  now?: () => number;
}

interface Entry {
  /** A `blob:` address, or null when the picture couldn't be loaded. */
  src: string | null;
  at: number;
}

export function createImageLoader(fetchBytes: (key: string) => Promise<ArrayBuffer>, options: Options = {}): ImageLoader {
  const { isLocal = () => false, maxParallel = 4, maxCached = 1000, retryAfterMs = 30_000, now = Date.now } = options;
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<string | null>>();
  const waiting: Array<() => void> = [];
  let running = 0;
  const versions = new Map<string, number>();
  const listeners = new Set<() => void>();

  const peek = (key: string): string | null | undefined => {
    if (isLocal(key)) return key;
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.src === null && now() - hit.at > retryAfterMs) return undefined;
    // Most recently used goes last, so the oldest is what gets dropped.
    cache.delete(key);
    cache.set(key, hit);
    return hit.src;
  };

  const remember = (key: string, src: string | null) => {
    cache.delete(key);
    cache.set(key, { src, at: now() });
    while (cache.size > maxCached) {
      const [oldest, entry] = cache.entries().next().value as [string, Entry];
      cache.delete(oldest);
      if (entry.src) URL.revokeObjectURL(entry.src);
    }
  };

  const acquire = () =>
    running < maxParallel
      ? (running++, Promise.resolve())
      : new Promise<void>((go) => {
          waiting.push(() => {
            running++;
            go();
          });
        });

  const release = () => {
    running--;
    waiting.shift()?.();
  };

  const load = (key: string): Promise<string | null> => {
    const known = peek(key);
    if (known !== undefined) return Promise.resolve(known);
    const pending = inflight.get(key);
    if (pending) return pending;

    const version = versions.get(key) ?? 0;
    const job = (async () => {
      await acquire();
      try {
        const src = URL.createObjectURL(new Blob([await fetchBytes(key)]));
        if ((versions.get(key) ?? 0) !== version) { URL.revokeObjectURL(src); return null; }
        remember(key, src);
        return src;
      } catch {
        if ((versions.get(key) ?? 0) === version) remember(key, null);
        return null;
      } finally {
        release();
        if ((versions.get(key) ?? 0) === version) inflight.delete(key);
      }
    })();
    inflight.set(key, job);
    return job;
  };

  const invalidate = (keys: string[]) => {
    for (const key of keys) { const old = cache.get(key); if (old?.src) URL.revokeObjectURL(old.src); cache.delete(key); inflight.delete(key); versions.set(key, (versions.get(key) ?? 0) + 1); }
    listeners.forEach((fn) => fn());
  };
  return { peek, load, invalidate, subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}
