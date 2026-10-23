import { useEffect, useRef } from "react";
import { saveQueue, type SavedDownload } from "../lib/storage";
import type { DownloadItem } from "./useDownloads";

/**
 * Saves unfinished downloads (at most once a second) so they can be resumed after a restart. Does nothing until the
 * saved queue has been loaded, otherwise an empty start-up state would overwrite it.
 */
export function useQueuePersistence(items: DownloadItem[], loaded: boolean) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!loaded || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const unfinished: SavedDownload[] = itemsRef.current
        .filter((i) => i.status !== "completed")
        .map((i) => ({
          id: i.id,
          recoveryId: i.recoveryId ?? i.id, estimatedBytes: i.estimatedBytes, expectedVolume: i.expectedVolume,
          title: i.title,
          url: i.url,
          thumbnail: i.thumbnail,
          preset: i.preset,
          outDir: i.outDir,
          extra: i.extra,
          status: i.status,
          progress: i.progress,
          clipKey: i.clipKey,
          placeholderTitle: i.placeholderTitle,
          channel: i.channel,
        }));
      saveQueue(unfinished);
    }, 1000);
  }, [items, loaded]);
}
