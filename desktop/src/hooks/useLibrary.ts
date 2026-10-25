import { covers } from "../lib/covers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, libraryAnalyze, libraryEditTags, libraryLoad, libraryScan, type EditResult, type LibTrack } from "../lib/api";
import { unmeasured } from "../lib/loudness";
import type { TagEditRequest } from "../lib/tagEdit";
import { libraryAddFolder, libraryForgetMissing, libraryFolders, libraryLocate, libraryRemoveFolder, type MusicFolder } from "../lib/api";
import { loadLibraryWatch, saveLibraryWatch } from "../lib/storage";

interface Args {
  /** The folders are registered with the backend, so they can be looked through. */
  ready: boolean;
  /** How many downloads are in History: when it grows, something new finished and the library is looked at again. */
  historyCount: number;
  historyKey?: string;
  showFlash: (text: string, error?: boolean) => void;
}

const RESCAN_AFTER_DOWNLOAD_MS = 2000;

/**
 * The music library: what was found last time (instantly), then a scan that reads only what is new or changed. It looks again a
 * moment after each download finishes.
 */
export function useLibrary({ ready, historyCount, historyKey, showFlash }: Args) {
  const [tracks, setTracks] = useState<LibTrack[]>([]);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const busy = useRef(false);
  const scanned = useRef(false);
  const lastScan = useRef(0);
  const pending = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [watching, setWatchingState] = useState(true);
  const [watchLoaded, setWatchLoaded] = useState(false);
  useEffect(() => { let stale = false; void loadLibraryWatch().then((watch) => { if (!stale) { setWatchingState(watch); setWatchLoaded(true); } }); return () => { stale = true; }; }, []);

  const scan = useCallback(async (quiet = false): Promise<void> => {
    if (busy.current) { pending.current = true; return; }
    busy.current = true;
    lastScan.current = Date.now();
    setScanning({ done: 0, total: 0 });
    try {
      const tracks = await libraryScan((done, total) => setScanning({ done, total }));
      setTracks((old) => old.length === tracks.length && tracks.every((t, i) => Object.keys(t).every((key) => t[key as keyof LibTrack] === old[i][key as keyof LibTrack])) ? old : tracks);
      setFolders(await libraryFolders());
      scanned.current = true;
    } catch (e) {
      if (!quiet) showFlash(errorText(e), true);
    } finally {
      busy.current = false;
      setScanning(null);
      setLoaded(true);
      if (pending.current && readyRef.current) { pending.current = false; queueMicrotask(() => void scan(true)); }
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

  const revision = historyKey ?? String(historyCount);
  const lastCount = useRef(revision);
  useEffect(() => {
    const grew = revision !== lastCount.current;
    lastCount.current = revision;
    if (!grew || !scanned.current) return;
    const timer = setTimeout(() => void scan(), RESCAN_AFTER_DOWNLOAD_MS);
    return () => clearTimeout(timer);
  }, [revision, scan]);

  useEffect(() => {
    if (!ready || !watchLoaded || !watching) return;
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void scan(true); }, 5 * 60_000);
    const focused = () => { if (Date.now() - lastScan.current >= 60_000) void scan(true); };
    window.addEventListener("focus", focused);
    return () => { clearInterval(timer); window.removeEventListener("focus", focused); };
  }, [ready, watchLoaded, watching, scan]);

  const setWatching = useCallback((watch: boolean) => { setWatchingState(watch); void saveLibraryWatch(watch); }, []);
  const addFolder = useCallback(async () => { try { setFolders(await libraryAddFolder()); await scan(); } catch (e) { showFlash(errorText(e), true); } }, [scan, showFlash]);
  const removeFolder = useCallback(async (path: string) => { try { setFolders(await libraryRemoveFolder(path)); await scan(); } catch (e) { showFlash(errorText(e), true); } }, [scan, showFlash]);
  const locate = useCallback(async (path: string) => {
    const found = await libraryLocate(path);
    if (found) setTracks((prev) => [...prev.filter((t) => t.path !== path && t.path !== found.track.path), found.track]);
    return found;
  }, []);

  const forgetMissing = useCallback(async (paths: string[]) => {
    const results = await libraryForgetMissing(paths);
    const removed = new Set(results.filter((r) => r.ok).map((r) => r.path));
    setTracks((prev) => prev.filter((t) => !removed.has(t.path)));
    // A background scan may have read the old cache just before the removal.
    // Queue a fresh scan so it cannot leave forgotten entries visible.
    await scan(true);
    return results;
  }, [scan]);

  /** Changes the tags of some files, and shows the new tags at once. */
  const editTags = useCallback(async (paths: string[], edit: TagEditRequest): Promise<EditResult[]> => {
    const results = await libraryEditTags(paths, edit);
    const updated = new Map(results.flatMap((r) => (r.ok && r.track ? [[r.path, r.track] as const] : [])));
    if (edit.artwork) covers.invalidate?.([...updated.keys()]);
    // Changing tags doesn't change how loud a song is.
    if (updated.size > 0) setTracks((prev) => prev.map((t) => { const n = updated.get(t.path); return n ? { ...n, added: t.added || t.modified, loudness: t.loudness } : t; }));
    return results;
  }, []);

  /** Measures how loud these songs are and shows the result. Songs that can't be measured aren't tried again this session. */
  const failed = useRef(new Set<string>());
  const [failedCount, setFailedCount] = useState(0);
  const unmeasuredCount = useMemo(() => unmeasured(tracks).filter((p) => !failed.current.has(p)).length, [tracks, failedCount]);
  const measure = useCallback(async (paths: string[]) => {
    const wanted = paths.filter((p) => !failed.current.has(p));
    if (wanted.length === 0) return;
    const results = await libraryAnalyze(wanted);
    for (const r of results) if (r.loudness == null) failed.current.add(r.path);
    setFailedCount(failed.current.size);
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

  return { tracks, scanning, loaded, scan, editTags, measure, analysing, analyse, stopAnalysing, unmeasuredCount,
    management: { folders, watching, setWatching, addFolder, removeFolder, locate, forgetMissing } };
}

export type LibraryManagement = ReturnType<typeof useLibrary>["management"];
