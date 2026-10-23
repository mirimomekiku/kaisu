import type { ExtraOptions } from "./api";
import type { SavedDownload } from "./storage";
import { checkDownloadUrl, checkSpeedLimit } from "./validate";
import { checkCustomName } from "./output";

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const pick = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => {
  if (v === undefined || v === null) return fallback;
  if (!values.includes(v as T)) throw new Error("Invalid saved option.");
  return v as T;
};
const text = (v: unknown, max = 8192): string | null => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > max || v.includes("\0")) throw new Error("Invalid saved text.");
  return v;
};
export const safeConcurrency = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? Math.min(6, Math.max(1, Math.round(v))) : 2;

/** Defaults support older queues; malformed choices are refused instead of silently changing a download. */
export function sanitizeDownloadExtra(value: unknown): ExtraOptions {
  const r = object(value), output = object(r.output);
  const limit = text(r.rate_limit, 32);
  if (checkSpeedLimit(limit ?? "")) throw new Error("Invalid saved speed limit.");
  const custom = text(output.custom, 300);
  if (custom && checkCustomName(custom)) throw new Error("Invalid saved file name.");
  const clip = object(r.clip);
  if (r.clip != null && !(typeof clip.start === "number" && Number.isFinite(clip.start) && clip.start >= 0 && typeof clip.end === "number" && Number.isFinite(clip.end) && clip.end > clip.start && clip.end <= 172800)) throw new Error("Invalid saved clip.");
  const playlist = object(r.playlist);
  if (r.playlist != null && !(typeof playlist.title === "string" && playlist.title.length <= 1000 && Number.isInteger(playlist.index) && Number.isInteger(playlist.total) && Number(playlist.index) >= 1 && Number(playlist.index) <= Number(playlist.total) && Number(playlist.total) <= 100000)) throw new Error("Invalid saved playlist.");
  const format = text(r.format_id, 64);
  if (format && !/^[a-z0-9_.*+\-]+$/i.test(format)) throw new Error("Invalid saved format.");
  const subs = object(r.subs), meta = object(r.meta), cover = object(r.cover), audio = object(r.audio);
  const langs = Array.isArray(subs.langs) ? subs.langs.filter((v): v is string => typeof v === "string" && v.length <= 80).slice(0, 20) : [];
  return {
    credentials_required: r.credentials_required === true,
    collision: pick(r.collision, ["keep_both", "skip", "replace"] as const, "keep_both"),
    sponsorblock: pick(r.sponsorblock, ["off", "mark", "remove"], "off"),
    cookies_from_browser: r.cookies_from_browser == null ? null : pick(r.cookies_from_browser, ["firefox", "chrome", "chromium", "edge", "brave", "opera", "vivaldi"] as const, "firefox"),
    audio_format: pick(r.audio_format, ["mp3", "m4a", "opus", "flac", "wav"], "mp3"),
    proxy: null, format_id: format, rate_limit: limit, custom_args: text(r.custom_args, 16384), verbose: r.verbose === true, clean_titles: r.clean_titles === true,
    output: { layout: pick(output.layout, ["flat", "channel", "kind", "year", "music"], "flat"), name: pick(output.name, ["title_id", "title", "channel_title", "date_title", "track_title"], "title_id"), custom, playlist_folder: output.playlist_folder !== false, playlist_numbering: output.playlist_numbering !== false },
    clip: r.clip == null ? null : { start: Number(clip.start), end: Number(clip.end), precise: clip.precise === true },
    playlist: r.playlist == null ? null : { title: String(playlist.title), index: Number(playlist.index), total: Number(playlist.total) },
    subs: r.subs == null ? null : { langs, embed: subs.embed === true, file: subs.file === true, auto: subs.auto === true },
    meta: r.meta == null ? null : Object.fromEntries(["title", "artist", "album", "year", "track", "genre"].map((key) => [key, text(meta[key], 200)])),
    cover: r.cover == null ? null : { mode: pick(cover.mode, ["default", "square", "none", "custom"], "default"), path: text(cover.path) },
    audio: r.audio == null ? null : { quality: text(audio.quality, 16), normalize: audio.normalize === true, trim_silence: audio.trim_silence === true },
    lyrics: r.lyrics == null ? null : pick(r.lyrics, ["off", "file", "embed", "both"] as const, "off"),
  };
}
export function sanitizeDownloadQueue(value: unknown): SavedDownload[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(), out: SavedDownload[] = [];
  for (const item of value.slice(0, 1000)) {
    try {
      const r = object(item);
      if (typeof r.id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(r.id) || seen.has(r.id)) continue;
      if (typeof r.url !== "string" || checkDownloadUrl(r.url)) continue;
      if (typeof r.outDir !== "string" || !/^(\/|[a-z]:[\\/]|\\\\)/i.test(r.outDir) || r.outDir.length > 8192 || /[\x00-\x1f]/.test(r.outDir)) continue;
      if (!["best", "p1080", "p720", "audio", "audio_mp3"].includes(String(r.preset))) continue;
      const extra = sanitizeDownloadExtra(r.extra);
      out.push({ id: r.id, title: text(r.title, 2000) || r.url, url: r.url.trim(), thumbnail: text(r.thumbnail) || "", preset: r.preset === "audio_mp3" ? "audio" : r.preset as SavedDownload["preset"], outDir: r.outDir, extra,
        status: ["error", "cancelled"].includes(String(r.status)) ? String(r.status) : "paused",
        progress: typeof r.progress === "number" && Number.isFinite(r.progress) ? Math.min(99, Math.max(0, r.progress)) : 0,
        clipKey: extra.clip ? `${extra.clip.start}-${extra.clip.end}` : undefined, placeholderTitle: r.placeholderTitle === true, channel: text(r.channel, 2000) ?? undefined,
        recoveryId: typeof r.recoveryId === "string" && /^[a-z0-9_-]{1,128}$/i.test(r.recoveryId) ? r.recoveryId : r.id,
        expectedVolume: typeof r.expectedVolume === "number" && Number.isSafeInteger(r.expectedVolume) && r.expectedVolume >= 0 ? r.expectedVolume : undefined,
        estimatedBytes: typeof r.estimatedBytes === "number" && Number.isSafeInteger(r.estimatedBytes) && r.estimatedBytes > 0 ? r.estimatedBytes : undefined,
      }); seen.add(r.id);
    } catch { /* One damaged entry must not discard the rest of the saved queue. */ }
  }
  return out;
}
