import type { LibTrack } from "./api";
import type { Playlist } from "./playlists";
import type { Listening } from "./listening";
import type { MusicPreferences } from "./musicPreferences";
import { albumsOf } from "./library";
import { smartTracks } from "./smartPlaylists";

export interface PortableDevice { id: string; label: string; location: string; transport: "mounted_folder" }
export interface PortableProfile { id: string; name: string; folder: string; volume: number | null; format: "original" | "mp3"; bitrate: number; source_kind: "library" | "playlists" | "albums"; source_ids: string[]; available: boolean; message: string }
export interface PortablePlaylist { id: string; name: string; paths: string[] }
export interface SyncProgress { phase: string; done: number; total: number; title: string }
export interface SyncPlan { id: string; destination: string; additions: string[]; unchanged: number; removals: string[]; protected: string[]; needed_bytes: number; free_bytes: number; conversion: boolean }
export interface SyncResult { copied: number; removed: number; unchanged: number; warnings: string[] }
export function portableSelection(profile: Pick<PortableProfile, "source_kind" | "source_ids">, tracks: LibTrack[], playlists: Playlist[], stats: Listening, preferences: MusicPreferences) {
  const available = new Map(tracks.filter((t) => !t.missing).map((t) => [t.path, t]));
  let lists: PortablePlaylist[] = [];
  if (profile.source_kind === "playlists") lists = playlists.filter((p) => profile.source_ids.includes(p.id)).map((p) => ({ id: p.id, name: p.name, paths: (p.smart ? smartTracks(tracks, p.smart, stats, Date.now(), preferences).map((t) => t.path) : p.paths).filter((p) => available.has(p)) }));
  if (profile.source_kind === "albums") lists = albumsOf(tracks.filter((t) => !t.missing)).filter((a) => profile.source_ids.includes(a.key)).map((a) => ({ id: `album:${a.key}`, name: `${a.artist} - ${a.title}`, paths: a.tracks.map((t) => t.path) }));
  return { paths: profile.source_kind === "library" ? [...available.keys()] : [...new Set(lists.flatMap((p) => p.paths))], playlists: lists };
}
