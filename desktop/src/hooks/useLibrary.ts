import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, libraryAnalyze, libraryEditTags, libraryLoad, libraryScan, type EditResult, type LibTrack } from "../lib/api";
import { unmeasured } from "../lib/loudness";
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
    // Changing tags doesn't change how loud a song is.
    if (updated.size > 0) setTracks((prev) => prev.map((t) => { const n = updated.get(t.path); return n ? { ...n, loudness: t.loudness } : t; }));
    return results;
  }, []);

  /** Measures how loud these songs are and shows the result. Songs that can't be measured aren't tried again this session. */
  const failed = useRef(new Set<string>());
  const measure = useCallback(async (paths: string[]) => {
    const wanted = paths.filter((p) => !failed.current.has(p));
    if (wanted.length === 0) return;
    const results = await libraryAnalyze(wanted);
    for (const r of results) if (r.loudness == null) failed.current.add(r.path);
    const got = new Map(results.flatMap((r) => (r.loudness == null ? [] : [[r.path, r.loudness] as const])));
    if (got.size > 0) setTracks((prev) => prev.map((t) => (got.has(t.path) ? { ...t, loudness: got.get(t.path)! } : t)));
  }, []);

  // Measuring the whole library, a few songs at a time, until done or stopped.
  const [analysing, setAnalysing] = useState<{ done: number; total: number } | null>(null);
  const stop = useRef(false);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const analyse = useCallback(async () => {
    if (analysing) return;
    const todo = unmeasured(tracksRef.current).filter((p) => !failed.current.has(p));
    if (todo.length === 0) return;
    stop.current = false;
    setAnalysing({ done: 0, total: todo.length });
    try {
      for (let i = 0; i < todo.length && !stop.current; i += 5) {
        await measure(todo.slice(i, i + 5));
        setAnalysing({ done: Math.min(todo.length, i + 5), total: todo.length });
      }
    } catch (e) {
      showFlash(errorText(e), true);
    } finally {
      setAnalysing(null);
    }
  }, [analysing, measure, showFlash]);
  const stopAnalysing = useCallback(() => {
    stop.current = true;
  }, []);

  return { tracks, scanning, loaded, scan, editTags, measure, analysing, analyse, stopAnalysing };
}
