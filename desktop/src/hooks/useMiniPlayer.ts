import { useCallback, useRef, useState } from "react";
import { errorText, setMiniMode } from "../lib/api";

export function useMiniPlayer(showFlash: (text: string, error?: boolean) => void) {
  const [mini, setMini] = useState(false);
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const change = useCallback(async (next: boolean) => {
    if (changing.current) return;
    changing.current = true; setBusy(true);
    try { await setMiniMode(next); setMini(next); }
    catch (e) { showFlash(errorText(e), true); }
    finally { changing.current = false; setBusy(false); }
  }, [showFlash]);
  return { mini, busy, change };
}
