import { fetchThumbnail } from "./api";

// The page may not load pictures from the internet itself, so thumbnails are fetched by Kaisu (through the proxy) and
// shown from memory. This keeps a few requests in flight at a time and remembers what it has fetched.

const MAX_PARALLEL = 4;
const MAX_CACHED = 1000;
const RETRY_AFTER_MS = 30_000;

interface Entry {
  /** A `blob:` address, or null when the picture couldn't be loaded. */
  src: string | null;
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let running = 0;

/** Pictures that need no fetching: ones already in memory or built into the app. */
const isLocal = (url: string) => /^(data:|blob:)/i.test(url);

/** What is known without fetching: a picture address, null if it failed lately, or undefined if nobody has asked yet. */
export function peekThumbnail(url: string): string | null | undefined {
  if (isLocal(url)) return url;
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (hit.src === null && Date.now() - hit.at > RETRY_AFTER_MS) return undefined;
  // Most recently used goes last, so the oldest is what gets dropped.
  cache.delete(url);
  cache.set(url, hit);
  return hit.src;
}

function remember(url: string, src: string | null) {
  cache.delete(url);
  cache.set(url, { src, at: Date.now() });
  while (cache.size > MAX_CACHED) {
    const [oldest, entry] = cache.entries().next().value as [string, Entry];
    cache.delete(oldest);
    if (entry.src) URL.revokeObjectURL(entry.src);
  }
}

const acquire = () =>
  running < MAX_PARALLEL
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

/** The picture at `url` as something an `<img>` can show, or null if it can't be loaded. */
export function loadThumbnail(url: string): Promise<string | null> {
  const known = peekThumbnail(url);
  if (known !== undefined) return Promise.resolve(known);
  const pending = inflight.get(url);
  if (pending) return pending;

  const job = (async () => {
    await acquire();
    try {
      const bytes = await fetchThumbnail(url);
      const src = URL.createObjectURL(new Blob([bytes]));
      remember(url, src);
      return src;
    } catch {
      remember(url, null);
      return null;
    } finally {
      release();
      inflight.delete(url);
    }
  })();
  inflight.set(url, job);
  return job;
}
