import { useEffect, useRef, useState } from "react";
import { errorText, openFolder, quitApp, systemPower } from "../lib/api";
import { notify } from "../lib/notify";
import type { DownloadItem } from "./useDownloads";

export type WhenDone = "nothing" | "folder" | "quit" | "sleep" | "shutdown";
export const COUNTDOWN_SECONDS = 30;

/** What happened since downloads last went idle, for the "finished" notification. */
export interface SessionStats {
  completed: number;
  failed: number;
  lastDir: string;
  failedIds: Set<string>;
}
const fresh = (): SessionStats => ({ completed: 0, failed: 0, lastDir: "", failedIds: new Set() });

export function useSessionStats() {
  return useRef<SessionStats>(fresh());
}

interface Options {
  items: DownloadItem[];
  /** Downloads running or waiting. When it falls back to zero, a batch has finished. */
  busyCount: number;
  session: React.MutableRefObject<SessionStats>;
  notifyWhenDone: boolean;
  outDir: string;
  showFlash: (text: string, error?: boolean) => void;
  announce: (note: { title: string; subtitle?: string }) => void;
}

/**
 * When a batch of downloads finishes: say so (display, and a notification if Kaisu isn't focused), then run the
 * one-shot "when done" action. Sleep and shut down get a 30-second cancellable countdown first.
 */
export function useBatchFinish({ items, busyCount, session, notifyWhenDone, outDir, showFlash, announce }: Options) {
  const [whenDone, setWhenDone] = useState<WhenDone>("nothing");
  const [countdown, setCountdown] = useState<{ action: "sleep" | "shutdown"; seconds: number } | null>(null);
  const prevBusy = useRef(0);
  const latest = useRef({ whenDone, notifyWhenDone, outDir });
  latest.current = { whenDone, notifyWhenDone, outDir };

  useEffect(() => {
    // Count each failure once.
    for (const i of items) {
      if (i.status === "error" && !session.current.failedIds.has(i.id)) {
        session.current.failedIds.add(i.id);
        session.current.failed += 1;
      }
    }
    const was = prevBusy.current;
    prevBusy.current = busyCount;
    if (!(was > 0 && busyCount === 0)) return;

    const { completed, failed, lastDir } = session.current;
    session.current = fresh();
    if (completed + failed === 0) return;

    const body = completed > 0 ? `${completed} downloaded${failed ? `, ${failed} failed` : ""}` : `${failed} failed`;
    announce({ title: completed > 0 ? "Downloads finished" : "Downloads failed", subtitle: body });
    if (latest.current.notifyWhenDone && !document.hasFocus()) notify("Kaisu: downloads finished", body);

    const action = latest.current.whenDone;
    if (action !== "nothing" && completed > 0) {
      setWhenDone("nothing"); // one-shot
      const folder = lastDir || latest.current.outDir;
      if (action === "folder" && folder) openFolder(folder).catch((e) => showFlash(errorText(e), true));
      else if (action === "quit") quitApp().catch(() => {});
      else if (action === "sleep" || action === "shutdown") setCountdown({ action, seconds: COUNTDOWN_SECONDS });
    }
  }, [busyCount, items, session, announce, showFlash]);

  useEffect(() => {
    if (!countdown) return;
    if (countdown.seconds <= 0) {
      systemPower(countdown.action).catch((e) => showFlash(errorText(e), true));
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => setCountdown({ ...countdown, seconds: countdown.seconds - 1 }), 1000);
    return () => clearTimeout(timer);
  }, [countdown, showFlash]);

  return { whenDone, setWhenDone, countdown, cancelCountdown: () => setCountdown(null) };
}
