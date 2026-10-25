import type { MusicPreferences } from "./musicPreferences";
import type { LibTrack } from "./api";
import type { Listening } from "./listening";
import { normalize } from "./library";

export type SmartField = "folder" | "duration" | "title" | "artist" | "album" | "genre" | "format" | "year" | "plays" | "added" | "played" | "favorite" | "rating";
export interface SmartRule { field: SmartField; op: string; value: string }
export const SMART_SORTS = ["title", "artist", "album", "added", "plays", "lastPlayed", "rating", "duration"] as const;
export type SmartSort = typeof SMART_SORTS[number];
export const SMART_SORT_LABELS: Record<SmartSort, string> = { title: "Title", artist: "Artist", album: "Album", added: "Date added", plays: "Play count", lastPlayed: "Last played", rating: "Rating", duration: "Duration" };
export interface SmartRules { match: "all" | "any"; rules: SmartRule[]; sort?: SmartSort; descending?: boolean; limit?: number }
export const SMART_FIELDS: SmartField[] = ["title", "artist", "album", "genre", "format", "year", "plays", "added", "played", "favorite", "rating", "folder", "duration"];
export const operators = (field: SmartField): string[] => field === "folder" ? ["is", "contains"] : ["played", "favorite"].includes(field) ? ["is"] : field === "added" ? ["within_days"] : ["year", "plays", "rating", "duration"].includes(field) ? ["is", "at_least", "at_most"] : ["contains", "is"];
export const blankSmartRule = (field: SmartField = "artist"): SmartRule => ({ field, op: operators(field)[0], value: field === "favorite" ? "yes" : field === "played" ? "never" : field === "added" ? "30" : "" });

export function smartProblem(smart: SmartRules): string | null {
  if (!["all", "any"].includes(smart.match) || !Array.isArray(smart.rules) || smart.rules.length === 0 || smart.rules.length > 20) return "Add between 1 and 20 rules.";
  if (smart.sort !== undefined && !SMART_SORTS.includes(smart.sort)) return "Choose a valid playlist order.";
  if (smart.descending !== undefined && typeof smart.descending !== "boolean") return "Choose a valid playlist direction.";
  if (smart.limit !== undefined && (!Number.isInteger(smart.limit) || smart.limit < 1 || smart.limit > 5000)) return "Limit playlists to between 1 and 5,000 songs.";
  for (const r of smart.rules) {
    if (!r || !SMART_FIELDS.includes(r.field) || !operators(r.field).includes(r.op) || typeof r.value !== "string" || !r.value.trim() || r.value.length > 200) return "Complete each rule with a valid value.";
    if (["year", "plays", "added", "rating", "duration"].includes(r.field)) {
      const n = Number(r.value);
      if (!/^\d+$/.test(r.value) || !Number.isSafeInteger(n) || n < (r.field === "added" ? 1 : 0) || n > (r.field === "rating" ? 5 : r.field === "added" ? 36500 : 999999)) return "Use a valid whole number in each numeric rule.";
    }
    if (r.field === "favorite" && !["yes", "no"].includes(r.value)) return "Choose favorite or not favorite.";
    if (r.field === "played" && !["never", "played"].includes(r.value)) return "Choose played or never played.";
  }
  return null;
}

export function sanitizeSmart(raw: unknown): SmartRules | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as SmartRules;
  if (smartProblem(r) !== null) return undefined;
  return { match: r.match, rules: r.rules.map(({ field, op, value }) => ({ field, op, value: value.trim() })),
    ...(r.sort !== undefined ? { sort: r.sort } : {}), ...(r.descending !== undefined ? { descending: r.descending } : {}), ...(r.limit !== undefined ? { limit: r.limit } : {}) };
}

export function smartTracks(tracks: LibTrack[], smart: SmartRules, stats: Listening, now = Date.now(), preferences: MusicPreferences = {}): LibTrack[] {
  if (smartProblem(smart)) return [];
  const matched = tracks.filter((t) => {
    if (t.missing) return false;
    const matches = (r: SmartRule) => {
      const plays = stats[t.path]?.plays ?? 0;
      if (r.field === "favorite") return !!preferences[t.path]?.favorite === (r.value === "yes");
      if (r.field === "played") return r.value === "never" ? plays === 0 : plays > 0;
      if (r.field === "added") {
        const added = (t.added || t.modified) * 1000;
        return added > 0 && added <= now && now - added <= Number(r.value) * 86_400_000;
      }
      if (r.field === "folder") {
        // Match directory boundaries, across Windows and Unix paths. Subfolders are included.
        const path = normalize(t.path.replace(/\\/g, "/"));
        const parent = path.slice(0, path.lastIndexOf("/"));
        const value = normalize(r.value.trim().replace(/\\/g, "/").replace(/\/+$/, ""));
        return r.op === "is" ? parent === value || parent.startsWith(`${value}/`) : parent.includes(value);
      }
      if (r.field === "year" || r.field === "plays" || r.field === "rating" || r.field === "duration") {
        const got = r.field === "duration" ? t.duration > 0 ? t.duration : null : r.field === "year" ? t.year : r.field === "rating" ? (preferences[t.path]?.rating ?? 0) : plays;
        if (got == null) return false;
        const n = Number(r.value);
        return r.op === "at_least" ? got >= n : r.op === "at_most" ? got <= n : got === n;
      }
      const got = normalize(t[r.field]);
      const value = normalize(r.value.trim());
      return r.op === "contains" ? got.includes(value) : got === value;
    };
    return smart.match === "all" ? smart.rules.every(matches) : smart.rules.some(matches);
  });
  const value = (t: LibTrack): string | number => {
    switch (smart.sort ?? "title") {
      case "title": return t.title;
      case "artist": return t.album_artist.trim() || t.artist;
      case "album": return t.album;
      case "added": return t.added || t.modified;
      case "plays": return stats[t.path]?.plays ?? 0;
      case "lastPlayed": return stats[t.path]?.lastPlayed ?? 0;
      case "rating": return preferences[t.path]?.rating ?? 0;
      case "duration": return t.duration;
    }
  };
  return matched.sort((a, b) => {
    const x = value(a), y = value(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (smart.descending ? -order : order) || a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
  }).slice(0, smart.limit ?? 5000);
}

export const SMART_PRESETS: Array<{ name: string; smart: SmartRules }> = [
  { name: "Recently added", smart: { match: "all", rules: [{ field: "added", op: "within_days", value: "30" }], sort: "added", descending: true, limit: 100 } },
  { name: "Most played", smart: { match: "all", rules: [{ field: "played", op: "is", value: "played" }], sort: "plays", descending: true, limit: 50 } },
  { name: "Never played", smart: { match: "all", rules: [{ field: "played", op: "is", value: "never" }], sort: "added", descending: true } },
  { name: "Favorites", smart: { match: "all", rules: [{ field: "favorite", op: "is", value: "yes" }], sort: "artist" } },
  { name: "Top rated", smart: { match: "all", rules: [{ field: "rating", op: "at_least", value: "4" }], sort: "rating", descending: true } },
];
