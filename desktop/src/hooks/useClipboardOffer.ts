import { useEffect, useRef, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { extractUrls, isMediaHost } from "../lib/links";

/**
 * Notices a video link on the clipboard when the window gains focus. Only well-known media sites count, only a lone
 * link counts, and the same link isn't offered twice. Nothing is read while the window is in the background.
 */
export function useClipboardOffer(enabled: boolean, currentInput: string) {
  const [offer, setOffer] = useState<string | null>(null);
  const lastOffered = useRef("");
  const input = useRef(currentInput);
  input.current = currentInput;

  useEffect(() => {
    if (!enabled) return;
    const check = async () => {
      if (!document.hasFocus()) return;
      try {
        const text = ((await readText()) ?? "").trim();
        const links = extractUrls(text);
        if (links.length !== 1 || links[0] !== text || !isMediaHost(text)) return;
        if (text === lastOffered.current || text === input.current.trim()) return;
        lastOffered.current = text;
        setOffer(text);
      } catch {
        /* the clipboard may be empty or hold something that isn't text */
      }
    };
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [enabled]);

  return { offer, dismiss: () => setOffer(null) };
}
