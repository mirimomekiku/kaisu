import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, libraryEditTags, libraryLoad, libraryScan, type EditResult, type LibTrack } from "../lib/api";
import type { TagEditRequest } from "../lib/tagEdit";

interface Args {
  /** The folders are registered with the backend, so they can be looked through. */
  ready: boolean;
  /** How many downloads are in History: when it grows, something new finished and the library is looked at again. */
  historyCount: number;
  showFlash: (text: string, error?: boolean) => void;
}

const RESCAN_AFTER_DOWNLOAD_MS = 2000;

/**
 * The music library: what was found last time (instantly), then a scan that reads only what is new or changed. It looks again a
 * moment after each download finishes.
 */
export function useLibrary({ ready, historyCount, showFlash }: Args) {
  const [tracks, setTracks] = useState<LibTrack[]>([]);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const busy = useRef(false);
  const scanned = useRef(false);

  const scan = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setScanning({ done: 0, total: 0 });
    try {
      setTracks(await libraryScan((done, total) => setScanning({ done, total })));
      scanned.current = true;
    } catch (e) {
      showFlash(errorText(e), true);
    } finally {
      busy.current = false;
      setScanning(null);
      setLoaded(true);
    }
  }, [showFlash]);

  // Show what is remembered at once, then look for changes.
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    libraryLoad().then(
      (remembered) => {
        // A scan that finished first is newer than what was remembered.
        if (!stale && !scanned.current) setTracks(remembered);
        if (!stale) setLoaded(true);
      },
      () => !stale && setLoaded(true),
    );
    void scan();
    return () => {
      stale = true;
    };
  }, [ready, scan]);

  const lastCount = useRef(historyCount);
  useEffect(() => {
    const grew = historyCount > lastCount.current;
    lastCount.current = historyCount;
    if (!grew || !scanned.current) return;
    const timer = setTimeout(() => void scan(), RESCAN_AFTER_DOWNLOAD_MS);
    return () => clearTimeout(timer);
  }, [historyCount, scan]);

  /** Changes the tags of some files, and shows the new tags at once. */
  const editTags = useCallback(async (paths: string[], edit: TagEditRequest): Promise<EditResult[]> => {
    const results = await libraryEditTags(paths, edit);
    const updated = new Map(results.flatMap((r) => (r.ok && r.track ? [[r.path, r.track] as const] : [])));
    if (updated.size > 0) setTracks((prev) => prev.map((t) => updated.get(t.path) ?? t));
    return results;
  }, []);

  return { tracks, scanning, loaded, scan, editTags };
}
