import { useEffect, useRef } from "react";
import type { Page } from "../components/Sidebar";

export interface ShortcutContext {
  page: Page;
  hasResults: boolean;
  hasOpenVideo: boolean;
  anythingPaused: boolean;
  hasOutDir: boolean;
  selectedCount: number;
  showShortcuts: () => void;
  goTo: (page: Page) => void;
  focusSearch: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  downloadOpenVideo: (asAudio: boolean) => void;
  togglePauseAll: () => void;
  openDownloadFolder: () => void;
  openLatest: () => void;
  /** The music player. */
  playerToggle: () => void;
  playerNext: () => void;
  playerPrevious: () => void;
}

const PAGES: Page[] = ["search", "downloads", "history", "settings", "library"];

/** Global keyboard shortcuts. The cheat sheet (lib/shortcuts.ts) lists what is handled here. */
export function useShortcuts(ctx: ShortcutContext) {
  const latest = useRef(ctx);
  latest.current = ctx;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = latest.current;
      if (e.isComposing) return;
      // Dialogs and menus handle their own keys.
      if (document.querySelector("[role=alertdialog], [role=dialog][aria-modal=true], [role=menu]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const typing = !!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");

      if (e.key === "F1" || (mod && key === "/")) {
        e.preventDefault();
        c.showShortcuts();
      } else if (mod && !e.altKey && !e.shiftKey && ["f", "l", "k"].includes(key)) {
        e.preventDefault();
        c.focusSearch();
      } else if (mod && !e.altKey && ["1", "2", "3", "4", "5"].includes(key)) {
        e.preventDefault();
        c.goTo(PAGES[Number(key) - 1]);
      } else if (mod && key === ",") {
        e.preventDefault();
        c.goTo("settings");
      } else if (mod && key === "a" && !typing && c.page === "search" && c.hasResults) {
        e.preventDefault();
        c.selectAll();
      } else if (mod && key === "d" && c.hasOpenVideo) {
        e.preventDefault();
        c.downloadOpenVideo(e.shiftKey);
      } else if (mod && e.shiftKey && key === "p") {
        e.preventDefault();
        c.togglePauseAll();
      } else if (mod && e.shiftKey && key === " ") {
        e.preventDefault();
        c.playerToggle();
      } else if (mod && e.shiftKey && key === "arrowright") {
        e.preventDefault();
        c.playerNext();
      } else if (mod && e.shiftKey && key === "arrowleft") {
        e.preventDefault();
        c.playerPrevious();
      } else if (mod && e.shiftKey && key === "l") {
        e.preventDefault();
        c.openLatest();
      } else if (mod && key === "o" && c.hasOutDir) {
        e.preventDefault();
        c.openDownloadFolder();
      } else if (e.key === "Escape") {
        if (c.selectedCount > 0) c.clearSelection();
        else if (typing) (e.target as HTMLElement).blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
