import { useCallback, useEffect, useRef, useState } from "react";
import { addPaths, checkName, createPlaylist, MAX_PLAYLISTS, moveTrack, removeAt, type Playlist } from "../lib/playlists";
import { loadPlaylists, savePlaylists } from "../lib/storage";

/** The user's playlists, kept between sessions. Every change is saved at once. */
export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<Playlist[]>([]);

  useEffect(() => {
    let stale = false;
    void loadPlaylists().then((saved) => {
      if (stale) return;
      latest.current = saved;
      setPlaylists(saved);
      setLoaded(true);
    });
    return () => {
      stale = true;
    };
  }, []);

  const commit = useCallback((next: Playlist[]) => {
    latest.current = next;
    setPlaylists(next);
    void savePlaylists(next);
  }, []);

  const change = useCallback((id: string, fn: (p: Playlist) => Playlist) => commit(latest.current.map((p) => (p.id === id ? fn(p) : p))), [commit]);

  /** Makes a playlist; returns it, or why not. */
  const create = useCallback(
    (name: string, paths: string[] = []): { playlist: Playlist } | { problem: string } => {
      const problem = checkName(name, latest.current) ?? (latest.current.length >= MAX_PLAYLISTS ? "That's the most playlists there can be." : null);
      if (problem) return { problem };
      const playlist = createPlaylist(name, paths);
      commit([playlist, ...latest.current]);
      return { playlist };
    },
    [commit],
  );

  const rename = useCallback(
    (id: string, name: string): string | null => {
      const problem = checkName(name, latest.current, id);
      if (problem) return problem;
      change(id, (p) => ({ ...p, name: name.trim(), updated: Date.now() }));
      return null;
    },
    [change],
  );

  const remove = useCallback((id: string) => commit(latest.current.filter((p) => p.id !== id)), [commit]);

  /** Adds songs; returns how many were new. */
  const add = useCallback(
    (id: string, paths: string[]): number => {
      const p = latest.current.find((x) => x.id === id);
      if (!p) return 0;
      const r = addPaths(p, paths);
      if (r.added > 0) change(id, () => r.playlist);
      return r.added;
    },
    [change],
  );

  const removeTrack = useCallback((id: string, index: number) => change(id, (p) => removeAt(p, index)), [change]);
  const move = useCallback((id: string, from: number, to: number) => change(id, (p) => moveTrack(p, from, to)), [change]);

  return { playlists, loaded, create, rename, remove, add, removeTrack, move };
}

export type PlaylistsApi = ReturnType<typeof usePlaylists>;
