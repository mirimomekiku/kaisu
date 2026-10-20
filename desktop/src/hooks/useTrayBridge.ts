import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { setTrayStatus, trayAvailable, type CloseMode } from "../lib/api";
import { notify } from "../lib/notify";

interface Options {
  active: number;
  queued: number;
  paused: number;
  closeMode: CloseMode;
  /** Settings have loaded, so `closeMode` is the real value and not the default. */
  ready: boolean;
  pauseAll: () => void;
  resumeAll: () => void;
}

/**
 * Keeps the tray icon and the close button informed about the queue, and reacts to the tray menu. Returns whether a tray
 * is available on this desktop (null while unknown).
 */
export function useTrayBridge({ active, queued, paused, closeMode, ready, pauseAll, resumeAll }: Options) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const actions = useRef({ pauseAll, resumeAll });
  actions.current = { pauseAll, resumeAll };

  useEffect(() => {
    trayAvailable().then(setAvailable).catch(() => setAvailable(null));
  }, []);

  useEffect(() => {
    if (ready) setTrayStatus(active, queued, paused, closeMode).catch(() => {});
  }, [active, queued, paused, closeMode, ready]);

  useEffect(() => {
    let dead = false;
    const offs: Array<() => void> = [];
    const on = (name: string, fn: (payload: unknown) => void) =>
      listen(name, (e) => fn(e.payload))
        .then((off) => (dead ? off() : offs.push(off)))
        .catch(() => {});
    on("tray-action", (action) => (action === "pause_all" ? actions.current.pauseAll() : actions.current.resumeAll()));
    on("background-started", () => notify("Kaisu is still downloading", "It keeps going in the background. Open it again from the tray icon, or launch Kaisu again."));
    return () => {
      dead = true;
      offs.forEach((off) => off());
    };
  }, []);

  return available;
}
