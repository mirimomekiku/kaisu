import type { Track } from "./audioEngine";
export interface ListeningEntry { plays: number; lastPlayed: number; seconds?: number; lastListened?: number; title?: string; artist?: string }
export type Listening = Record<string, ListeningEntry>;
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
export function sanitizeListening(raw: unknown): Listening {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).slice(0, 100_000).flatMap(([path, value]) => {
    if (!path || !value || typeof value !== "object") return [];
    const v = value as Partial<ListeningEntry>;
    if (!positive(v.plays) || typeof v.lastPlayed !== "number" || !Number.isFinite(v.lastPlayed)) return [];
    return [[path, { plays: Math.floor(v.plays), lastPlayed: Math.max(0, v.lastPlayed),
      ...(positive(v.seconds) ? { seconds: v.seconds } : {}), ...(positive(v.lastListened) ? { lastListened: v.lastListened } : {}),
      ...(typeof v.title === "string" ? { title: v.title.slice(0, 500) } : {}), ...(typeof v.artist === "string" ? { artist: v.artist.slice(0, 500) } : {}) }]];
  }));
}
export function recordPlayed(stats: Listening, path: string, now = Date.now(), info?: Partial<Track>): Listening {
  return { ...stats, [path]: { ...stats[path], plays: (stats[path]?.plays ?? 0) + 1, lastPlayed: now, ...(info?.title ? { title: info.title } : {}), ...(info?.artist ? { artist: info.artist } : {}) } };
}
export function recordListeningTime(stats: Listening, track: Track, seconds: number, now = Date.now()): Listening {
  if (!Number.isFinite(seconds) || seconds <= 0) return stats;
  return { ...stats, [track.path]: { ...(stats[track.path] ?? { plays: 0, lastPlayed: 0 }), seconds: (stats[track.path]?.seconds ?? 0) + seconds, lastListened: now, title: track.title, artist: track.artist ?? "" } };
}
export function mergeListening(a: ListeningEntry | undefined, b: ListeningEntry): ListeningEntry {
  return { ...a, ...b, plays: (a?.plays ?? 0) + b.plays, lastPlayed: Math.max(a?.lastPlayed ?? 0, b.lastPlayed),
    ...((a?.seconds !== undefined || b.seconds !== undefined) ? { seconds: (a?.seconds ?? 0) + (b.seconds ?? 0) } : {}),
    ...((a?.lastListened !== undefined || b.lastListened !== undefined) ? { lastListened: Math.max(a?.lastListened ?? 0, b.lastListened ?? 0) } : {}) };
}
