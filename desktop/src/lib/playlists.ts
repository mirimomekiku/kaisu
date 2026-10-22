import { moveItem } from "./playQueue";
import { sanitizeSmart, type SmartRules } from "./smartPlaylists";

// Playlists: named lists of files. They hold paths only; what to show for each song is looked up in the library.

export interface Playlist {
  id: string;
  name: string;
  /** Files, in order. */
  paths: string[];
  /** When it last changed (ms since 1970). */
  updated: number;
  smart?: SmartRules;
}

export const MAX_PLAYLISTS = 200;
export const MAX_TRACKS = 5000;
export const MAX_NAME_CHARS = 80;

let counter = 0;
const newId = () => `pl-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Why a name can't be used, or null. `except` is the playlist being renamed (its own name is fine). */
export function checkName(name: string, others: Playlist[], except?: string): string | null {
  const n = name.trim();
  if (!n) return "Give the playlist a name.";
  if (n.length > MAX_NAME_CHARS) return `Playlist names can be up to ${MAX_NAME_CHARS} characters.`;
  if (others.some((p) => p.id !== except && p.name.trim().toLowerCase() === n.toLowerCase())) return "You already have a playlist with that name.";
  return null;
}

export function createPlaylist(name: string, paths: string[] = [], now = Date.now(), smart?: SmartRules): Playlist {
  return { id: newId(), name: name.trim(), paths: smart ? [] : [...new Set(paths)].slice(0, MAX_TRACKS), updated: now, ...(smart ? { smart } : {}) };
}

/** Adds files that aren't there yet, at the end. */
export function addPaths(p: Playlist, paths: string[], now = Date.now()): { playlist: Playlist; added: number } {
  if (p.smart) return { playlist: p, added: 0 };
  const have = new Set(p.paths);
  const fresh = [...new Set(paths)].filter((x) => !have.has(x)).slice(0, Math.max(0, MAX_TRACKS - p.paths.length));
  return fresh.length === 0 ? { playlist: p, added: 0 } : { playlist: { ...p, paths: [...p.paths, ...fresh], updated: now }, added: fresh.length };
}

export function removeAt(p: Playlist, index: number, now = Date.now()): Playlist {
  if (p.smart) return p;
  return index < 0 || index >= p.paths.length ? p : { ...p, paths: p.paths.filter((_, i) => i !== index), updated: now };
}

export function moveTrack(p: Playlist, from: number, to: number, now = Date.now()): Playlist {
  if (p.smart) return p;
  const moved = moveItem(p.paths, -1, from, to).queue;
  return moved === p.paths ? p : { ...p, paths: moved, updated: now };
}

/** Whatever was saved: keep only what is shaped like a playlist. */
export function sanitizePlaylists(raw: unknown): Playlist[] {
  if (!Array.isArray(raw)) return [];
  const out: Playlist[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_PLAYLISTS)) {
    const p = r as Partial<Playlist> | null;
    if (!p || typeof p.name !== "string" || !p.name.trim() || !Array.isArray(p.paths)) continue;
    const smart = sanitizeSmart(p.smart);
    if (p.smart !== undefined && !smart) continue;
    const id = typeof p.id === "string" && p.id && !seen.has(p.id) ? p.id : newId();
    seen.add(id);
    out.push({
      id,
      name: p.name.trim().slice(0, MAX_NAME_CHARS),
      paths: p.paths.filter((x): x is string => typeof x === "string" && x !== "").slice(0, MAX_TRACKS),
      updated: typeof p.updated === "number" && Number.isFinite(p.updated) ? p.updated : 0,
      ...(smart ? { smart } : {}),
    });
  }
  return out;
}

export interface TrackInfo {
  title: string;
  artist?: string;
  /** Seconds. */
  duration?: number;
}

/** The playlist as an extended M3U file, which most players open. */
export function toM3u(p: Playlist, info: (path: string) => TrackInfo | undefined): string {
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const lines = ["#EXTM3U", `#PLAYLIST:${oneLine(p.name)}`];
  for (const path of p.paths) {
    const t = info(path);
    if (t) lines.push(`#EXTINF:${Math.round(t.duration && t.duration > 0 ? t.duration : -1)},${oneLine(t.artist ? `${t.artist} - ${t.title}` : t.title)}`);
    lines.push(path);
  }
  return `${lines.join("\n")}\n`;
}

/** A name that is safe as a file name on Windows and Linux, ending in .m3u8. */
export function m3uFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 80);
  return `${base || "Playlist"}.m3u8`;
}
