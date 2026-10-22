import type { LibTrack } from "./api";
import type { Listening } from "./listening";
import { baseName } from "./mediaKind";
export function listeningSummary(tracks: LibTrack[], stats: Listening) {
  const byPath = new Map(tracks.map((t) => [t.path, t]));
  const songs = Object.entries(stats).map(([path, entry]) => ({ path, ...entry, title: byPath.get(path)?.title || entry.title || baseName(path), artist: byPath.get(path)?.artist || entry.artist || "Unknown artist", track: byPath.get(path) }));
  const artists = new Map<string, { name: string; plays: number; seconds: number }>();
  for (const s of songs) {
    const a = artists.get(s.artist) ?? { name: s.artist, plays: 0, seconds: 0 };
    a.plays += s.plays; a.seconds += s.seconds ?? 0; artists.set(s.artist, a);
  }
  return {
    plays: songs.reduce((sum, s) => sum + s.plays, 0), seconds: songs.reduce((sum, s) => sum + (s.seconds ?? 0), 0),
    unique: songs.filter((s) => s.plays > 0 || (s.seconds ?? 0) > 0).length,
    recent: songs.filter((s) => Math.max(s.lastPlayed, s.lastListened ?? 0) > 0).sort((a, b) => Math.max(b.lastPlayed, b.lastListened ?? 0) - Math.max(a.lastPlayed, a.lastListened ?? 0) || a.title.localeCompare(b.title)).slice(0, 20),
    top: songs.filter((s) => s.plays > 0).sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title)).slice(0, 20),
    artists: [...artists.values()].filter((a) => a.plays > 0 || a.seconds > 0).sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || a.name.localeCompare(b.name)).slice(0, 20),
  };
}
export function listeningDuration(seconds: number): string {
  const n = Math.floor(Math.max(0, seconds));
  return n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m` : n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`;
}
