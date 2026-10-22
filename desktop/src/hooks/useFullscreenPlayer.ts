import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../lib/api";

/** Window transitions happen on user actions, preserving the previous OS fullscreen state. */
export function useFullscreenPlayer() {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previous = useRef<boolean | null>(null);
  const changing = useRef(false);
  const alive = useRef(true);
  const origin = useRef<HTMLElement | null>(null);
  const enter = useCallback(async (trigger?: HTMLElement) => {
    if (changing.current || previous.current !== null) return;
    origin.current = trigger ?? document.activeElement as HTMLElement | null;
    changing.current = true; setBusy(true); setError(null);
    try {
      const win = getCurrentWindow();
      const was = await win.isFullscreen();
      if (!alive.current) return;
      if (!was) await win.setFullscreen(true);
      if (!alive.current) { if (!was) await win.setFullscreen(false); return; }
      previous.current = was; setExpanded(true);
    } catch (e) { if (alive.current) setError(`Couldn't open the full-screen player: ${errorText(e)}`); }
    finally { changing.current = false; if (alive.current) setBusy(false); }
  }, []);
  const exit = useCallback(async () => {
    if (changing.current || previous.current === null) return;
    const was = previous.current;
    previous.current = null;
    changing.current = true; setBusy(true);
    try { await getCurrentWindow().setFullscreen(was); }
    catch (e) { if (alive.current) setError(`Couldn't restore the window: ${errorText(e)}`); }
    finally { changing.current = false; if (alive.current) { setExpanded(false); setBusy(false); } }
  }, []);
  useEffect(() => {
    if (!expanded && !busy && origin.current) {
      const trigger = origin.current; origin.current = null;
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    }
  }, [expanded, busy]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (previous.current !== null) {
        const was = previous.current; previous.current = null;
        void getCurrentWindow().setFullscreen(was).catch(() => {});
      }
    };
  }, []);
  useEffect(() => {
    if (!expanded) return;
    let dead = false;
    let off: (() => void) | undefined;
    const win = getCurrentWindow();
    const refresh = () => { void win.isFullscreen().then((full) => { if (!full && !dead && !changing.current) { previous.current = null; setExpanded(false); } }).catch(() => {}); };
    void win.onResized(refresh).then((unlisten) => { if (dead) unlisten(); else off = unlisten; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [expanded]);
  return { expanded, busy, error, enter, exit };
}
