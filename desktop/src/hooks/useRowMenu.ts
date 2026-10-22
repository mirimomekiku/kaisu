import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

/** Pointer and keyboard context menus share an item identity and return focus to their originating row. */
export function useRowMenu(ids: readonly string[]) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setMenu(null);
    if (origin.current?.isConnected) origin.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => { if (menu && !ids.includes(menu.id)) close(); }, [ids, menu, close]);
  const show = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, id: string) => {
    if ((e.target as HTMLElement).closest('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], .selectable')) return;
    if ("key" in e && e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
    e.preventDefault(); e.stopPropagation();
    origin.current = e.currentTarget;
    e.currentTarget.focus({ preventScroll: true });
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ id, x: "clientX" in e ? e.clientX : rect.left + 20, y: "clientY" in e ? e.clientY : Math.min(rect.bottom, rect.top + 32) });
  };
  const bind = (id: string) => ({
    tabIndex: 0,
    onContextMenu: (e: MouseEvent<HTMLElement>) => show(e, id),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => show(e, id),
  });
  return { menu, close, bind };
}
