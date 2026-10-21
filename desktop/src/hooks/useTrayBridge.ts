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
  /** Music is playing, so closing the window keeps Kaisu running in the background. */
  playing: boolean;
  /** The music items in the tray menu. */
  onPlayer: (action: "toggle" | "next" | "previous") => void;
}

/**
 * Keeps the tray icon and the close button informed about the queue, and reacts to the tray menu. Returns whether a tray
 * is available on this desktop (null while unknown).
 */
export function useTrayBridge({ active, queued, paused, closeMode, ready, pauseAll, resumeAll, playing, onPlayer }: Options) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const actions = useRef({ pauseAll, resumeAll, onPlayer });
  actions.current = { pauseAll, resumeAll, onPlayer };

  useEffect(() => {
    trayAvailable().then(setAvailable).catch(() => setAvailable(null));
  }, []);

  useEffect(() => {
    if (ready) setTrayStatus(active, queued, paused, closeMode, playing).catch(() => {});
  }, [active, queued, paused, closeMode, ready, playing]);

  useEffect(() => {
    let dead = false;
    const offs: Array<() => void> = [];
    const on = (name: string, fn: (payload: unknown) => void) =>
      listen(name, (e) => fn(e.payload))
        .then((off) => (dead ? off() : offs.push(off)))
        .catch(() => {});
    on("tray-action", (action) => {
      if (action === "pause_all") actions.current.pauseAll();
      else if (action === "resume_all") actions.current.resumeAll();
      else if (action === "player_toggle") actions.current.onPlayer("toggle");
      else if (action === "player_next") actions.current.onPlayer("next");
      else if (action === "player_previous") actions.current.onPlayer("previous");
    });
    on("background-started", () => notify("Kaisu is still downloading", "It keeps going in the background. Open it again from the tray icon, or launch Kaisu again."));
    return () => {
      dead = true;
      offs.forEach((off) => off());
    };
  }, []);

  return available;
}
