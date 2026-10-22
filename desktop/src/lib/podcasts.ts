import type { PodcastEpisode, PodcastFeed } from "./api";

export interface PodcastSubscription {
  id: string;
  url: string;
  title: string;
  image?: string;
  auto: boolean;
  seen: string[];
  checked: number;
}

export const MAX_SUBSCRIPTIONS = 50;
export const MAX_SEEN = 500;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function feedUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password || u.href.length > 2048) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

export const episodeDate = (published: string | null): number | null => {
  const n = published ? Date.parse(published) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Feed order is retained; repeated GUIDs in a broken feed must never queue twice. */
export function newEpisodes(feed: PodcastFeed, seen: string[]): PodcastEpisode[] {
  const have = new Set(seen);
  return feed.episodes.filter((episode) => {
    if (!episode.id || have.has(episode.id)) return false;
    have.add(episode.id);
    return true;
  });
}

export const rememberEpisodes = (ids: string[], seen: string[]): string[] => [...new Set([...ids, ...seen])].slice(0, MAX_SEEN);

/** One path segment on Windows and Linux, including Windows device-name handling. */
export function showFolder(title: string): string {
  let name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 64).replace(/[. ]+$/g, "");
  if (!name || name === "." || name === "..") name = "Podcast";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

export const podcastFolder = (base: string, title: string): string => `${base.replace(/[\\/]+$/, "")}/Podcasts/${showFolder(title)}`;

export function sanitizePodcasts(raw: unknown): PodcastSubscription[] {
  if (!Array.isArray(raw)) return [];
  const urls = new Set<string>();
  const ids = new Set<string>();
  const result: PodcastSubscription[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const url = typeof r.url === "string" ? feedUrl(r.url) : null;
    if (!url || urls.has(url) || typeof r.title !== "string" || !r.title.trim()) continue;
    urls.add(url);
    const id = typeof r.id === "string" && r.id && !ids.has(r.id) ? r.id.slice(0, 100) : crypto.randomUUID();
    if (ids.has(id)) continue;
    ids.add(id);
    result.push({
      id, url, title: r.title.trim().slice(0, 500),
      image: typeof r.image === "string" ? feedUrl(r.image) ?? undefined : undefined,
      auto: r.auto === true,
      seen: Array.isArray(r.seen) ? [...new Set(r.seen.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 2048))].slice(0, MAX_SEEN) : [],
      checked: typeof r.checked === "number" && Number.isFinite(r.checked) && r.checked >= 0 ? r.checked : 0,
    });
    if (result.length >= MAX_SUBSCRIPTIONS) break;
  }
  return result;
}
