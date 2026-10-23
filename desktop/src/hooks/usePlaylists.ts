import { useCallback, useEffect, useRef, useState } from "react";
import { addPaths, checkName, createPlaylist, MAX_PLAYLISTS, moveTrack, removeAt, sanitizeFolders, validPlaylistCover, type Playlist } from "../lib/playlists";
import { loadPlaylists, savePlaylists, loadPlaylistFolders, savePlaylistFolders } from "../lib/storage";
import { moveItem } from "../lib/playQueue";
import { smartProblem, type SmartRules } from "../lib/smartPlaylists";
import { relocatePlaylists } from "../lib/relocation";

/** The user's playlists, kept between sessions. Every change is saved at once. */
export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<Playlist[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const foldersRef = useRef<string[]>([]);

  useEffect(() => {
    let stale = false;
    void Promise.all([loadPlaylists(), loadPlaylistFolders()]).then(([saved, rawFolders]) => {
      if (stale) return;
      latest.current = saved;
      setPlaylists(saved);
      const names = sanitizeFolders([...(sanitizeFolders(rawFolders)), ...saved.flatMap((p) => p.folder ? [p.folder] : [])]);
      foldersRef.current = names; setFolders(names);
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
    (name: string, paths: string[] = [], smart?: SmartRules): { playlist: Playlist } | { problem: string } => {
      const problem = checkName(name, latest.current) ?? (latest.current.length >= MAX_PLAYLISTS ? "That's the most playlists there can be." : null);
      if (problem) return { problem };
      if (smart && smartProblem(smart)) return { problem: smartProblem(smart)! };
      const playlist = createPlaylist(name, paths, Date.now(), smart);
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

  const editSmart = useCallback((id: string, smart: SmartRules): string | null => {
    const problem = smartProblem(smart);
    if (problem) return problem;
    change(id, (p) => ({ ...p, smart, paths: [], updated: Date.now() }));
    return null;
  }, [change]);
  const relocate = useCallback((from: string, to: string) => {
    commit(relocatePlaylists(latest.current, from, to));
  }, [commit]);

  const saveFolders = (next: string[]) => { foldersRef.current = next; setFolders(next); void savePlaylistFolders(next); };
  const createFolder = (name: string): string | null => {
    const value = name.trim();
    if (!value || value.length > 80) return "Use a folder name between 1 and 80 characters.";
    if (foldersRef.current.some((f) => f.toLowerCase() === value.toLowerCase())) return "That folder already exists.";
    if (foldersRef.current.length >= 100) return "You can create up to 100 folders.";
    saveFolders([...foldersRef.current, value]); return null;
  };
  const renameFolder = (from: string, name: string): string | null => {
    const value = name.trim();
    if (!value || value.length > 80) return "Use a folder name between 1 and 80 characters.";
    if (foldersRef.current.some((f) => f !== from && f.toLowerCase() === value.toLowerCase())) return "That folder already exists.";
    saveFolders(foldersRef.current.map((f) => f === from ? value : f));
    commit(latest.current.map((p) => p.folder === from ? { ...p, folder: value } : p)); return null;
  };
  const removeFolder = (folder: string) => {
    // Save memberships first, so a removed folder cannot be recovered from stale playlists on restart.
    commit(latest.current.map((p) => p.folder === folder ? { ...p, folder: undefined } : p));
    saveFolders(foldersRef.current.filter((f) => f !== folder));
  };
  const organize = (id: string, folder: string) => change(id, (p) => ({ ...p, folder: foldersRef.current.includes(folder) ? folder : undefined }));
  const setCover = (id: string, cover?: string) => { if (cover === undefined || validPlaylistCover(cover)) change(id, (p) => ({ ...p, cover })); };
  const reorder = (from: string, to: string) => commit(moveItem(latest.current, -1, latest.current.findIndex((p) => p.id === from), latest.current.findIndex((p) => p.id === to)).queue);

  return { playlists, folders, loaded, create, rename, remove, add, removeTrack, move, editSmart, relocate, createFolder, renameFolder, removeFolder, organize, setCover, reorder };
}

export type PlaylistsApi = ReturnType<typeof usePlaylists>;
