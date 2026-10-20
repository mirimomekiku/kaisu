import type { SubtitleOptions, SubtitleTrack } from "./api";
import type { SubtitleMode } from "./storage";

/** Language codes typed like "en, de" (commas, spaces or semicolons), without blanks or repeats. */
export function parseLangs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const code = raw.trim();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Does a track (like "en-US" or "en-orig") satisfy a wanted language (like "en")? */
export function trackMatches(code: string, wanted: string): boolean {
  const w = wanted.replace(/\.\*$/, "").toLowerCase();
  const c = code.toLowerCase();
  return c === w || c.startsWith(`${w}-`) || c.startsWith(`${w}_`) || c.startsWith(`${w}.`);
}

/** The tracks to tick by default: the ones matching the languages in the user's settings. */
export function defaultSelection(tracks: SubtitleTrack[], prefs: string[]): string[] {
  const picked: string[] = [];
  for (const want of prefs) {
    const hit = tracks.find((t) => trackMatches(t.code, want));
    if (hit && !picked.includes(hit.code)) picked.push(hit.code);
  }
  return picked;
}

/** What to send to the backend, or null when nothing is wanted. */
export function toOptions(mode: SubtitleMode, langs: string[], auto: boolean): SubtitleOptions | null {
  if (mode === "off" || langs.length === 0) return null;
  return { langs, auto, embed: mode === "embed" || mode === "both", file: mode === "file" || mode === "both" };
}

export const SUBTITLE_MODE_LABEL: Record<SubtitleMode, string> = {
  off: "No subtitles",
  embed: "Inside the video",
  file: "Separate .srt files",
  both: "Both",
};
