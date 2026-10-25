import { useEffect, useRef } from "react";
import { registerStorageFlush, saveQueue } from "../lib/storage";
import { downloadSnapshot } from "../lib/downloadSnapshot";
import type { DownloadItem } from "./useDownloads";

/**
 * Saves unfinished downloads (at most once a second) so they can be resumed after a restart. Does nothing until the
 * saved queue has been loaded, otherwise an empty start-up state would overwrite it.
 */
export function useQueuePersistence(items: DownloadItem[], loaded: boolean) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const timer = useRef<number | null>(null);

  const flush = async () => {
    if (!loaded) return;
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    await saveQueue(downloadSnapshot(itemsRef.current));
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => registerStorageFlush(() => flushRef.current()), []);

  useEffect(() => {
    if (!loaded || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flushRef.current();
    }, 1000);
  }, [items, loaded]);
}
