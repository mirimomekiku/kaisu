import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkDestination, errorText, transferFiles } from "../lib/api";
import type { HistoryItem, Settings } from "../lib/storage";
import { pendingMoves } from "../lib/transfer";

const RECHECK_MS = 15_000;
const SETTLE_MS = 1_500;

export type Destination = { state: "off" } | { state: "checking" } | { state: "ready"; free: number } | { state: "missing"; message: string };

interface Args {
  settings: Settings;
  /** Where downloads are saved (the folder files are moved out of). */
  outDir: string;
  getHistory: () => HistoryItem[];
  history: HistoryItem[];
  existing: Record<string, boolean>;
  updateHistory: (next: HistoryItem[]) => void;
  announce: (note: { title: string; subtitle: string }) => void;
  showFlash: (text: string, error?: boolean) => void;
  ready: boolean;
  onRelocated: (from: string, to: string) => void;
  prepareMove: (paths: string[]) => () => void;
}

/**
 * Sends finished downloads to another folder (an external drive) as they complete, or when the drive is plugged in.
 * What is waiting is worked out from History: files still in the download folder that haven't been handled.
 */
export function useAutoMove(a: Args) {
  const { settings, outDir, existing } = a;
  const enabled = a.ready && settings.moveEnabled && settings.moveDir.trim() !== "" && outDir !== "";
  const [destination, setDestination] = useState<Destination>({ state: "off" });
  const [moving, setMoving] = useState(false);
  const busy = useRef(false);
  const lastError = useRef("");
  const argsRef = useRef(a);
  argsRef.current = a;

  const pending = useMemo(() => (enabled ? pendingMoves(a.history, outDir, settings.moveTypes, existing) : []), [enabled, a.history, outDir, settings.moveTypes, existing]);

  // Is the drive there? Looked at again every few seconds, so plugging it in is noticed.
  useEffect(() => {
    if (!enabled) {
      setDestination({ state: "off" });
      return;
    }
    let stale = false;
    const look = () =>
      checkDestination(settings.moveDir).then(
        (c) => !stale && setDestination({ state: "ready", free: c.free }),
        (e) => !stale && setDestination({ state: "missing", message: errorText(e) }),
      );
    setDestination({ state: "checking" });
    look();
    const timer = setInterval(look, RECHECK_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [enabled, settings.moveDir]);

  const run = useCallback(async (items: HistoryItem[]) => {
    const { settings: s, getHistory, updateHistory, announce, showFlash } = argsRef.current;
    if (busy.current || items.length === 0) return;
    busy.current = true;
    setMoving(true);
    const release = s.moveMode === "move" ? argsRef.current.prepareMove(items.flatMap((item) => item.path ? [item.path] : [])) : () => {};
    try {
      // The folders come from what Kaisu was told with `setManagedFolders`, not from here.
      const results = await transferFiles(
        items.map((h) => ({ id: h.id, path: h.path as string })),
        s.moveMode,
        s.moveConflict,
        s.moveKeepLayout,
      );
      const byId = new Map(results.map((r) => [r.id, r]));
      let done = 0;
      let firstError = "";
      let firstWarning = "";
      const next = getHistory().map((h) => {
        const r = byId.get(h.id);
        if (!r) return h;
        if (!r.ok) {
          firstError ||= r.error ?? "";
          return h;
        }
        firstWarning ||= r.warning ?? "";
        done += r.skipped ? 0 : 1;
        if (r.skipped) return { ...h, transferred: "skipped" };
        if (s.moveMode === "copy") return { ...h, transferred: r.new_path ?? "copied" };
        return { ...h, path: r.new_path ?? h.path };
      });
      updateHistory(next);
      if (s.moveMode === "move") {
        for (const item of items) {
          const result = byId.get(item.id);
          if (result?.ok && !result.skipped && result.new_path && item.path) argsRef.current.onRelocated(item.path, result.new_path);
        }
      }
      if (done > 0) announce({ title: `${s.moveMode === "copy" ? "Copied" : "Moved"} ${done} download${done === 1 ? "" : "s"}`, subtitle: s.moveDir });
      if (firstError && firstError !== lastError.current) {
        lastError.current = firstError;
        showFlash(firstError, true);
      } else if (firstWarning) {
        // The song arrived but a subtitle or lyrics file didn't: say so, instead of leaving them behind unnoticed.
        showFlash(firstWarning, true);
      }
    } catch (e) {
      const message = errorText(e);
      if (message !== lastError.current) {
        lastError.current = message;
        showFlash(message, true);
      }
    } finally {
      release();
      busy.current = false;
      setMoving(false);
    }
  }, []);

  // Automatic mode: as soon as something is waiting and the drive is there.
  useEffect(() => {
    if (!enabled || settings.moveWhen !== "done" || destination.state !== "ready" || pending.length === 0 || moving) return;
    const timer = setTimeout(() => void run(pending), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, settings.moveWhen, destination.state, pending, moving, run]);

  const moveNow = useCallback(() => {
    lastError.current = "";
    void run(pending);
  }, [pending, run]);

  return { pending, destination, moving, moveNow };
}
