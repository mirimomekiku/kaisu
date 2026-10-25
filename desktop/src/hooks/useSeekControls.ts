import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import type { PlayerEngine } from "../lib/audioEngine";
import { defaultSeek, type SeekPreferences } from "../lib/customization";
import { usePlaybackTools } from "./usePlaybackTools";

export function seekRelative(engine: PlayerEngine, direction: -1 | 1, preferences: SeekPreferences, fine = false) {
  const { position, duration } = engine.getTime();
  if (!(duration > 0) || !Number.isFinite(duration)) return;
  const step = fine ? preferences.fine : direction < 0 ? preferences.backward : preferences.forward;
  engine.seek(Math.max(0, Math.min(duration, position + direction * step)));
}

/** Keyboard and optional wheel seeking shared by the bar, fullscreen and mini-player. */
export function useSeekControls(engine: PlayerEngine) {
  const preferences = usePlaybackTools()?.seekPreferences ?? defaultSeek();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el || preferences.wheel === "off") return;
    let lastWheel = -Infinity;
    const onWheel = (e: WheelEvent) => {
      if (el.disabled || !e.deltaY || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      // Trackpads emit many events per gesture; avoid dozens of seeks in one frame.
      if (e.timeStamp - lastWheel < 120) return;
      lastWheel = e.timeStamp;
      const direction = ((e.deltaY > 0 ? 1 : -1) * (preferences.wheelInverted ? -1 : 1)) as -1 | 1;
      seekRelative(engine, direction, preferences, e.shiftKey);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [engine, preferences]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.currentTarget.disabled) return;
    const direction = ["ArrowLeft", "ArrowDown", "PageDown"].includes(e.key) ? -1 : ["ArrowRight", "ArrowUp", "PageUp"].includes(e.key) ? 1 : null;
    if (direction) { e.preventDefault(); e.stopPropagation(); seekRelative(engine, direction, preferences, e.shiftKey); }
  };
  return { ref: input, onKeyDown };
}

export function useSeekShortcuts(engine: PlayerEngine, preferences: SeekPreferences) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || !["j", "l"].includes(e.key.toLowerCase())) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) return;
      const modals = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"]'));
      const modal = modals[modals.length - 1];
      if (modal && modal.getAttribute("aria-label") !== "Full-screen player") return;
      if (!engine.getState().queue.length) return;
      e.preventDefault();
      seekRelative(engine, e.key.toLowerCase() === "j" ? -1 : 1, preferences, e.shiftKey);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [engine, preferences]);
}
