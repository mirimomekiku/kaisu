import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { takeIncomingLinks } from "../lib/api";

interface Handlers {
  onLink: (link: string) => void;
  onLinks: (links: string[]) => void;
}

/**
 * Receives links sent from the browser (kaisu://add). They are only shown for the user to review, like a dropped link.
 * Links that arrived before the window loaded are collected once on start.
 */
export function useIncomingLinks(ready: boolean, handlers: Handlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!ready) return;
    let dead = false;
    const collect = () =>
      takeIncomingLinks()
        .then((links) => {
          if (dead || links.length === 0) return;
          if (links.length === 1) latest.current.onLink(links[0]);
          else latest.current.onLinks(links);
        })
        .catch(() => {});
    void collect();
    let off: (() => void) | undefined;
    listen("kaisu-links", () => void collect()).then((fn) => (dead ? fn() : (off = fn))).catch(() => {});
    return () => {
      dead = true;
      off?.();
    };
  }, [ready]);
}
