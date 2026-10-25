import { useEffect, useState } from "react";
import { flushStorage } from "../lib/storage";
import { Minus, Plus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Whether the window has focus and is maximized, kept in sync with the OS. */
function useWindowState() {
  const [focused, setFocused] = useState(true);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let dead = false;
    const cleanups: Array<() => void> = [];
    const win = getCurrentWindow();
    const refresh = () =>
      win
        .isMaximized()
        .then((m) => !dead && setMaximized(m))
        .catch(() => {});
    refresh();
    const keep = (p: Promise<() => void>) => p.then((off) => (dead ? off() : cleanups.push(off))).catch(() => {});
    keep(win.onFocusChanged(({ payload }) => setFocused(payload)));
    keep(win.onResized(refresh));
    return () => {
      dead = true;
      cleanups.forEach((off) => off());
    };
  }, []);

  return { focused, maximized };
}

/** The red / yellow / green window buttons (the OS title bar is turned off, so the app draws its own). */
export default function WindowControls() {
  const { focused, maximized } = useWindowState();
  const win = () => getCurrentWindow();
  const swallow = (p: Promise<unknown>) => p.catch((e) => console.warn("window action failed", e));

  return (
    <div className={`lights ${focused ? "" : "inactive"}`} role="group" aria-label="Window controls">
      <button type="button" className="light close" aria-label="Close window" title="Close" onClick={() => swallow(flushStorage().then(() => win().close()))}>
        <X strokeWidth={3.5} />
      </button>
      <button type="button" className="light min" aria-label="Minimize window" title="Minimize" onClick={() => swallow(win().minimize())}>
        <Minus strokeWidth={3.5} />
      </button>
      <button
        type="button"
        className="light zoom"
        aria-label={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => swallow(win().toggleMaximize())}
      >
        <Plus strokeWidth={3.5} />
      </button>
    </div>
  );
}
