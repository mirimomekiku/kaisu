const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const PREFIX = /^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+/;
const OFFSET = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/im;
export interface LyricsDocument { text: string; revision: string; sidecar: boolean }
export interface LyricsSaved { document: LyricsDocument | null; embedded: boolean; sidecar: boolean; warnings: string[] }
export function lyricProblem(text: string): string | null {
  if (!text.trim()) return "Enter lyrics before saving.";
  if (new TextEncoder().encode(text).length > 512 * 1024) return "Lyrics must be no larger than 512 KB.";
  if (text.includes("\0")) return "Lyrics cannot contain NUL characters.";
  const offset = OFFSET.exec(text)?.[1];
  if (offset && (!Number.isFinite(Number(offset)) || Math.abs(Number(offset)) > 600000)) return "LRC offsets must be between -600000 and 600000 milliseconds.";
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[\d/.test(line) && !PREFIX.test(line.trimStart())) return "Use timestamps like [01:23.45].";
    for (const stamp of line.matchAll(STAMP)) if (Number(stamp[2]) >= 60) return "Timestamp seconds must be between 00 and 59.";
  }
  return null;
}
export function lrcStamp(seconds: number): string {
  const ticks = Math.max(0, Math.min(5_999_999, Math.round(seconds * 100)));
  return `[${String(Math.floor(ticks / 6000)).padStart(2, "0")}:${String(Math.floor(ticks / 100) % 60).padStart(2, "0")}.${String(ticks % 100).padStart(2, "0")}]`;
}
/** Bake the existing LRC offset into timestamps before shifting; positive is later. */
export function shiftLyrics(text: string, seconds: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds) > 600) throw new Error("Choose a timing shift between -600 and 600 seconds.");
  const offset = Number(OFFSET.exec(text)?.[1] ?? 0) / 1000;
  if (!Number.isFinite(offset) || Math.abs(offset) > 600) throw new Error("LRC offsets must be between -600000 and 600000 milliseconds.");
  return text.replace(/\r\n/g, "\n").split("\n").filter((line) => !/^\s*\[offset:/i.test(line)).map((line) => line.replace(/^(\s*)((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)/, (_, space: string, prefix: string) => space + prefix.replace(STAMP, (_stamp, min: string, sec: string, fraction: string | undefined) => lrcStamp(Number(min) * 60 + Number(sec) + (fraction ? Number(fraction) / 10 ** fraction.length : 0) - offset + seconds)))).join("\n");
}
export function stampLyricLine(text: string, line: number, seconds: number): { text: string; next: number } {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Playback time is unavailable.");
  if (/^\s*\[[a-z]+:/i.test(text.split("\n")[line] ?? "")) throw new Error("Select a lyric line with words to stamp.");
  const lines = shiftLyrics(text, 0).split("\n");
  // Preserve the selected content line when an offset header was removed.
  const removedBefore = text.split("\n").slice(0, line).filter((s) => /^\s*\[offset:/i.test(s)).length;
  const at = Math.max(0, line - removedBefore); const words = (lines[at] ?? "").trimStart().replace(PREFIX, "");
  if (!words.trim() || /^\[[a-z]+:/i.test(words)) throw new Error("Select a lyric line with words to stamp.");
  lines[at] = lrcStamp(seconds) + words;
  let next = at + 1;
  while (next < lines.length && (!lines[next].trim() || /^\[[a-z]+:/i.test(lines[next]))) next++;
  return { text: lines.join("\n"), next: Math.min(next, lines.length - 1) };
}
