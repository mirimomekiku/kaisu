import type { Leftover } from "./api";

/** `Daft Punk - One More Time [FGBhQbmPwH8].f251.m4a` → `Daft Punk - One More Time`. */
export function titleFromLeftover(name: string): string {
  const title = name
    .replace(/\.(?:part|ytdl)$/i, "")
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .replace(/\.f\d+$/i, "")
    .replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, "")
    .trim();
  return title || name;
}

/** The videos that could be asked for again: one entry per YouTube id found in the names (a video can leave several parts). */
export function resumableVideos(list: Leftover[]): Array<{ id: string; title: string }> {
  const seen = new Map<string, string>();
  for (const l of list) if (l.video_id && !seen.has(l.video_id)) seen.set(l.video_id, titleFromLeftover(l.name));
  return [...seen].map(([id, title]) => ({ id, title }));
}

export const totalBytes = (list: Leftover[]) => list.reduce((sum, l) => sum + l.size, 0);
