import type { PlayerEngine } from "./audioEngine";
import { mergeListening, type Listening } from "./listening";
import type { Playlist } from "./playlists";
import type { Positions } from "./positions";

export function relocateListening(stats: Listening, from: string, to: string): Listening {
  if (from === to || !stats[from]) return stats;
  const next = { ...stats, [to]: mergeListening(stats[to], stats[from]) };
  delete next[from];
  return next;
}

export function relocatePlaylists(playlists: Playlist[], from: string, to: string): Playlist[] {
  return playlists.map((p) => p.smart || !p.paths.includes(from) ? p : { ...p, paths: [...new Set(p.paths.map((path) => path === from ? to : path))] });
}

export function relocatePositions(positions: Positions, from: string, to: string): Positions {
  if (from === to || !positions[from]) return positions;
  const source = positions[from];
  const destination = positions[to];
  const next = { ...positions, [to]: destination && destination.at > source.at ? destination : source };
  delete next[from];
  return next;
}

interface RelocationStores {
  player: Pick<PlayerEngine, "replacePath">;
  listening: { relocate: (from: string, to: string) => void };
  preferences: { relocate: (from: string, to: string) => void };
  playlists: { relocate: (from: string, to: string) => void };
  history: (from: string, to: string) => void;
}

/** Shared by automatic transfers and Locate file. Flush playback under the old path before merging its records. */
export function relocateTrack(stores: RelocationStores, from: string, to: string) {
  if (from === to) return;
  stores.player.replacePath(from, to);
  stores.listening.relocate(from, to);
  stores.preferences.relocate(from, to);
  stores.playlists.relocate(from, to);
  stores.history(from, to);
}
