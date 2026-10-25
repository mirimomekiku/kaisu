import type { Settings } from "./storage";
import { validateRule, type ScheduleRule } from "./schedule";

/** Stored JSON is untrusted, including values written by older versions. */
export function settingsShape(raw: unknown, defaults: Settings): Settings {
  const saved = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const result: Record<string, unknown> = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = saved[key];
    if (Array.isArray(fallback)) { if (Array.isArray(value)) result[key] = value; }
    else if (fallback === null) { if (value === null || typeof value === "string") result[key] = value; }
    else if (typeof fallback === "object") { if (value && typeof value === "object" && !Array.isArray(value)) result[key] = value; }
    else if (typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value))) result[key] = value;
  }
  const choices: Record<string, string[]> = {
    mode: ["simple", "advanced"], viewSearch: ["details", "list", "grid", "compact"], viewQueue: ["details", "list", "grid", "compact"], viewHistory: ["details", "list", "grid", "compact"],
    sponsorblock: ["off", "mark", "remove"], subtitleMode: ["off", "embed", "file", "both"], audioFormat: ["mp3", "m4a", "opus", "flac", "wav"],
    coverMode: ["default", "square", "none"], lyricsMode: ["off", "file", "embed", "both"], layout: ["flat", "channel", "kind", "year", "music"],
    nameStyle: ["title_id", "title", "channel_title", "date_title", "track_title"], closeMode: ["downloads", "always", "never"], searchSource: ["youtube", "youtube_music", "soundcloud"],
    historySort: ["date", "title", "channel", "format", "size"],
  };
  for (const [key, values] of Object.entries(choices)) if (!values.includes(String(result[key]))) result[key] = defaults[key as keyof Settings];
  if (![null, "firefox", "chrome", "chromium", "edge", "brave", "opera", "vivaldi"].includes(result.cookiesBrowser as string | null)) result.cookiesBrowser = null;
  result.schedule = (result.schedule as unknown[]).slice(0, 100).filter((value): value is ScheduleRule => {
    if (!value || typeof value !== "object") return false;
    const r = value as ScheduleRule;
    return typeof r.id === "string" && Array.isArray(r.days) && r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      && typeof r.from === "string" && typeof r.to === "string" && typeof r.limit === "string" && ["limit", "pause"].includes(r.action) && validateRule(r) === null;
  });
  return result as unknown as Settings;
}
