import { errorText } from "../lib/api";
import { useEffect, useRef } from "react";
import { storageReadBlocked, type HistoryItem } from "../lib/storage";
import type { PlaylistsApi } from "./usePlaylists";

/** Completion intents remain in history until the playlist has been saved, including across restarts. */
export function useDownloadPlaylists(playlists: PlaylistsApi, history: HistoryItem[], historyRef: { current: HistoryItem[] }, update: (items: HistoryItem[]) => void, flash: (text: string, error?: boolean) => void) {
  const busy = useRef(false);
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!playlists.loaded || storageReadBlocked("playlists") || busy.current) return;
    busy.current = true;
    void (async () => {
      while (true) {
        const item = historyRef.current.find((h) => h.path && h.pendingPlaylistIds?.some((id) => !attempted.current.has(`${h.id}:${id}`)));
        if (!item?.path || !item.pendingPlaylistIds) break;
        const remaining = [...item.pendingPlaylistIds];
        for (const id of item.pendingPlaylistIds) {
          const key = `${item.id}:${id}`;
          if (attempted.current.has(key)) continue;
          attempted.current.add(key);
          const result = await playlists.addDownloaded(id, item.path);
          if (result === "saved" || result === "missing") remaining.splice(remaining.indexOf(id), 1);
          if (result === "missing") flash(`The destination playlist was removed. ${item.title} is saved in your library.`);
          if (result === "failed") flash(`${item.title} is saved, but it could not be added to its playlist. Kaisu will retry the next time it starts.`, true);
          if (result === "full") flash(`A playlist is full. ${item.title} is saved; remove some playlist songs and restart to retry.`, true);
        }
        if (remaining.length !== item.pendingPlaylistIds.length) update(historyRef.current.map((h) => h.id === item.id ? { ...h, pendingPlaylistIds: remaining.length ? remaining : undefined } : h));
      }
    })().catch((e) => flash(errorText(e), true)).finally(() => { busy.current = false; });
  }, [playlists.loaded, playlists.addDownloaded, history, historyRef, update, flash]);
}
