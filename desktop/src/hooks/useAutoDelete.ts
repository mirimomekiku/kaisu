import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteFiles, errorText } from "../lib/api";
import type { HistoryItem, Settings } from "../lib/storage";
import { oldDownloads } from "../lib/transfer";

const EVERY_MS = 60 * 60 * 1000;
const FIRST_LOOK_MS = 8_000;

interface Args {
  settings: Settings;
  outDir: string;
  history: HistoryItem[];
  existing: Record<string, boolean>;
  sizes: Record<string, number>;
  announce: (note: { title: string; subtitle: string }) => void;
  showFlash: (text: string, error?: boolean) => void;
  /** Called after files were deleted, so the file list can be checked again. */
  onDeleted: () => void;
  ready: boolean;
}

/** Deletes downloads older than the chosen number of days, from the download folder (and optionally the moved-to one). */
export function useAutoDelete(a: Args) {
  const { settings, outDir } = a;
  const dirs = useMemo(() => [outDir, ...(settings.autoDeleteMoved ? [settings.moveDir] : [])].filter((d) => d.trim() !== ""), [outDir, settings.autoDeleteMoved, settings.moveDir]);
  const [now, setNow] = useState(() => Date.now());
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const argsRef = useRef(a);
  argsRef.current = a;

  const candidates = useMemo(() => (a.ready ? oldDownloads(a.history, settings.autoDeleteDays, now, dirs, a.existing) : []), [a.ready, a.history, settings.autoDeleteDays, now, dirs, a.existing]);
  const bytes = candidates.reduce((sum, h) => sum + (h.path ? (a.sizes[h.path] ?? 0) : 0), 0);

  const run = useCallback(async (items: HistoryItem[], quiet: boolean) => {
    const { announce, showFlash, onDeleted } = argsRef.current;
    if (busy.current || items.length === 0) return;
    busy.current = true;
    setRunning(true);
    try {
      // Kaisu deletes only inside the folders it was told about (see `setManagedFolders`), never from a list given here.
      const results = await deleteFiles(items.map((h) => h.path as string), argsRef.current.settings.autoDeleteMoved, argsRef.current.settings.cleanupPermanent);
      const removed = results.filter((r) => r.ok).length;
      const failed = results.find((r) => !r.ok)?.error;
      if (removed > 0) {
        onDeleted();
        announce({ title: `${argsRef.current.settings.cleanupPermanent ? "Deleted" : "Recycled"} ${removed} old download${removed === 1 ? "" : "s"}`, subtitle: "Cleaned up" });
      }
      if (failed && !quiet) showFlash(failed, true);
      const warning = results.find((r) => r.warning)?.warning;
      if (warning && !quiet) showFlash(warning, true);
    } catch (e) {
      if (!quiet) showFlash(errorText(e), true);
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, []);

  // A look soon after start-up, then every hour while the app is open.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  useEffect(() => {
    if (!a.ready || settings.autoDeleteDays <= 0) return;
    const look = () => {
      setNow(Date.now());
      // `now` changes the candidate list on the next render; wait for it before deleting.
      setTimeout(() => void run(candidatesRef.current, true), 250);
    };
    const first = setTimeout(look, FIRST_LOOK_MS);
    const timer = setInterval(look, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [a.ready, settings.autoDeleteDays, run]);

  const cleanNow = useCallback(() => {
    setNow(Date.now());
    setTimeout(() => void run(candidatesRef.current, false), 250);
  }, [run]);

  return { candidates, bytes, running, cleanNow };
}
