import type { Preset } from "./api";

export const PRESET_LABEL: Record<Preset, string> = {
  best: "Best quality (MP4)",
  p1080: "1080p (MP4)",
  p720: "720p (MP4)",
  audio: "Audio only",
};

export function formatDuration(secs: number | null): string {
  if (secs == null) return "--:--";
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatSpeed(bytesPerSec: number | null): string {
  if (bytesPerSec == null) return "";
  const mb = bytesPerSec / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSec / 1024)} KB/s`;
}

export function formatEta(secs: number | null): string {
  if (secs == null) return "";
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s left` : `${secs}s left`;
}

/** 1234 -> "1.2K", 445392114 -> "445M". */
export function formatCount(n: number | null): string {
  if (n == null) return "";
  if (n < 1000) return String(n);
  const units: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  const [size, suffix] = units.find(([v]) => n >= v) as [number, string];
  const value = n / size;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}${suffix}`;
}

/** yt-dlp's `YYYYMMDD` -> "Feb 19, 2005". */
export function formatUploadDate(d: string | null): string {
  const m = d?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return "";
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatBytes(n: number): string {
  const mb = n / 1_048_576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/**
 * Parses what people type for a time: "90", "1:30", "1:02:03", "1:30.5". Returns seconds, or null if it isn't a time.
 * (No "1m30s" form: colons are what everyone already types.)
 */
export function parseTimeInput(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const nums = t.split(":").map(Number);
  // Minutes and seconds must be below 60; only the first field may be large ("90:00" is ninety minutes).
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((total, n) => total * 60 + n, 0);
}

/** 80 -> "1:20", 3725 -> "1:02:05". Like formatDuration but keeps a fraction out of the way. */
export function formatClock(seconds: number): string {
  return formatDuration(Math.round(seconds));
}

/** "80-165" (how clips are keyed) -> "1:20 to 2:45". */
export function clipLabel(key: string | undefined): string {
  const m = key?.match(/^([\d.]+)-([\d.]+)$/);
  return m ? `${formatClock(Number(m[1]))} to ${formatClock(Number(m[2]))}` : "";
}

/** The key that identifies a clip, e.g. "80-165". */
export const clipKeyOf = (clip: { start: number; end: number } | null): string | undefined => (clip ? `${clip.start}-${clip.end}` : undefined);
