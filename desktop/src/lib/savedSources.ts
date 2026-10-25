import type { AudioFormat, LinkKind, PlaylistInfo, Preset, SearchResult } from "./api";
import { canonicalUrl } from "./links";
import { redactText } from "./redact";
import { checkDownloadUrl } from "./validate";

/** Per-source limits keep kaisu.json small; the oldest entries go first. */
const MAX_SEEN = 5000;
const MAX_PENDING = 2000;

export interface SavedSource {
  id: string; url: string; title: string; kind: Exclude<LinkKind, "video">;
  preset: Preset; audioFormat: AudioFormat; playlistId: string;
  seen: string[]; pending: SearchResult[]; checked: number; total: number | null;
}
export const MAX_SAVED_SOURCES = 100;
export const SOURCE_CHECK_LIMIT = 500;
export function sourceUrl(value: string): string | null {
  const text = value.trim();
  if (checkDownloadUrl(text) || redactText(text) !== text) return null;
  try { const url = new URL(text); if (url.username || url.password) return null; url.hash = ""; return url.toString(); } catch { return null; }
}
function entry(raw: unknown): SearchResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SearchResult>;
  const url = typeof r.url === "string" ? sourceUrl(r.url) : null;
  if (!url || typeof r.id !== "string" || typeof r.title !== "string") return null;
  return { id: r.id.slice(0, 200), url, title: redactText(r.title).slice(0, 2000), thumbnail: typeof r.thumbnail === "string" ? redactText(r.thumbnail) : "", channel: typeof r.channel === "string" ? redactText(r.channel) : null,
    duration_secs: typeof r.duration_secs === "number" && Number.isFinite(r.duration_secs) ? r.duration_secs : null, view_count: typeof r.view_count === "number" && Number.isFinite(r.view_count) ? r.view_count : null, live: r.live === true };
}
export function refreshSource(source: SavedSource, listing: PlaylistInfo, now = Date.now()): SavedSource {
  const seen = new Set(source.seen.map(canonicalUrl));
  const pending = new Map(source.pending.map((item) => [canonicalUrl(item.url), item]));
  for (const raw of listing.entries) {
    const item = entry(raw); if (!item) continue;
    const key = canonicalUrl(item.url);
    if (!seen.has(key) || pending.has(key)) pending.set(key, item);
    seen.add(key);
  }
  return { ...source, title: redactText(listing.title).slice(0, 2000), kind: listing.kind === "channel" ? "channel" : "playlist", seen: [...seen].slice(-MAX_SEEN), pending: [...pending.values()].slice(-MAX_PENDING), checked: now, total: listing.total };
}
export function sanitizeSavedSources(raw: unknown): SavedSource[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>(), urls = new Set<string>();
  return raw.slice(0, MAX_SAVED_SOURCES).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const r = value as Partial<SavedSource>, url = typeof r.url === "string" ? sourceUrl(r.url) : null;
    if (!url || !r.id || !/^[a-z0-9_-]{1,128}$/i.test(r.id) || ids.has(r.id) || urls.has(url) || !["playlist", "channel"].includes(r.kind ?? "")) return [];
    ids.add(r.id); urls.add(url);
    const pending = Array.isArray(r.pending) ? [...new Map(r.pending.map(entry).filter((e): e is SearchResult => !!e).map((e) => [canonicalUrl(e.url), e])).values()].slice(-MAX_PENDING) : [];
    const seen = Array.isArray(r.seen) ? r.seen.filter((url): url is string => typeof url === "string" && !!sourceUrl(url)).map(canonicalUrl) : [];
    return [{ id: r.id, url, title: typeof r.title === "string" ? redactText(r.title).slice(0, 2000) : url, kind: r.kind as SavedSource["kind"],
      preset: ["best", "p1080", "p720", "audio"].includes(r.preset ?? "") ? r.preset! : "best", audioFormat: ["mp3", "m4a", "opus", "flac", "wav"].includes(r.audioFormat ?? "") ? r.audioFormat! : "mp3",
      playlistId: typeof r.playlistId === "string" && /^[a-z0-9_-]{1,128}$/i.test(r.playlistId) ? r.playlistId : "", pending,
      seen: [...new Set([...seen, ...pending.map((e) => canonicalUrl(e.url))])].slice(-MAX_SEEN), checked: typeof r.checked === "number" && Number.isFinite(r.checked) ? r.checked : 0,
      total: typeof r.total === "number" && Number.isFinite(r.total) && r.total >= 0 ? r.total : null }];
  });
}
