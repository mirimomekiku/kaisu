import type { MusicPreferences } from "./musicPreferences";
import type { LibTrack } from "./api";
import type { Listening } from "./listening";
import { normalize } from "./library";

export type SmartField = "title" | "artist" | "album" | "genre" | "format" | "year" | "plays" | "added" | "played" | "favorite" | "rating";
export interface SmartRule { field: SmartField; op: string; value: string }
export interface SmartRules { match: "all" | "any"; rules: SmartRule[] }
export const SMART_FIELDS: SmartField[] = ["title", "artist", "album", "genre", "format", "year", "plays", "added", "played", "favorite", "rating"];
export const operators = (field: SmartField): string[] => ["played", "favorite"].includes(field) ? ["is"] : field === "added" ? ["within_days"] : ["year", "plays", "rating"].includes(field) ? ["is", "at_least", "at_most"] : ["contains", "is"];
export const blankSmartRule = (field: SmartField = "artist"): SmartRule => ({ field, op: operators(field)[0], value: field === "favorite" ? "yes" : field === "played" ? "never" : field === "added" ? "30" : "" });

export function smartProblem(smart: SmartRules): string | null {
  if (!["all", "any"].includes(smart.match) || !Array.isArray(smart.rules) || smart.rules.length === 0 || smart.rules.length > 20) return "Add between 1 and 20 rules.";
  for (const r of smart.rules) {
    if (!r || !SMART_FIELDS.includes(r.field) || !operators(r.field).includes(r.op) || typeof r.value !== "string" || !r.value.trim() || r.value.length > 200) return "Complete each rule with a valid value.";
    if (["year", "plays", "added", "rating"].includes(r.field)) {
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
  return { match: r.match, rules: r.rules.map(({ field, op, value }) => ({ field, op, value: value.trim() })) };
}

export function smartTracks(tracks: LibTrack[], smart: SmartRules, stats: Listening, now = Date.now(), preferences: MusicPreferences = {}): LibTrack[] {
  if (smartProblem(smart)) return [];
  return tracks.filter((t) => {
    if (t.missing) return false;
    const matches = (r: SmartRule) => {
      const plays = stats[t.path]?.plays ?? 0;
      if (r.field === "favorite") return !!preferences[t.path]?.favorite === (r.value === "yes");
      if (r.field === "played") return r.value === "never" ? plays === 0 : plays > 0;
      if (r.field === "added") {
        const added = (t.added || t.modified) * 1000;
        return added > 0 && added <= now && now - added <= Number(r.value) * 86_400_000;
      }
      if (r.field === "year" || r.field === "plays" || r.field === "rating") {
        const got = r.field === "year" ? t.year : r.field === "rating" ? (preferences[t.path]?.rating ?? 0) : plays;
        if (got == null) return false;
        const n = Number(r.value);
        return r.op === "at_least" ? got >= n : r.op === "at_most" ? got <= n : got === n;
      }
      const got = normalize(t[r.field]);
      const value = normalize(r.value.trim());
      return r.op === "contains" ? got.includes(value) : got === value;
    };
    return smart.match === "all" ? smart.rules.every(matches) : smart.rules.some(matches);
  }).sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path)).slice(0, 5000);
}
