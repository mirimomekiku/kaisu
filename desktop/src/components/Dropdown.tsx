import { ChevronDown, Ellipsis, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ContextMenu, { type MenuEntry } from "./ContextMenu";

/** Anchored actions reuse the app's keyboard-accessible context menu. */
export function ActionMenu({ label, items, disabled = false, compact = false }: { label: string; items: MenuEntry[]; disabled?: boolean; compact?: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => { setPosition(null); trigger.current?.focus(); }, []);
  return <>
    <button ref={trigger} type="button" className={compact ? "row-btn" : "btn small"} disabled={disabled} aria-label={label} title={compact ? label : undefined} aria-haspopup="menu" aria-expanded={position !== null} onClick={() => {
      const rect = trigger.current!.getBoundingClientRect();
      setPosition(position ? null : { x: rect.left, y: rect.bottom + 4 });
    }}>{compact ? <Ellipsis className="w-4 h-4" /> : <>{label}<ChevronDown className="w-3 h-3" /></>}</button>
    {position && <ContextMenu {...position} label={label} items={items} onClose={close} />}
  </>;
}

/** A small nonmodal panel for related controls, kept within the viewport. */
export function FilterDropdown({ label, children }: { label: string; children: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const open = position !== null;
  const close = useCallback((restore = false) => { setPosition(null); if (restore) trigger.current?.focus(); }, []);
  useLayoutEffect(() => {
    if (!position || !panel.current) return;
    const bounds = panel.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(position.left, window.innerWidth - bounds.width - 8));
    const top = Math.max(8, Math.min(position.top, window.innerHeight - bounds.height - 8));
    if (left !== position.left || top !== position.top) setPosition({ left, top });
  });
  useEffect(() => {
    if (!open) return;
    (panel.current?.querySelector<HTMLElement>("input, select") ?? panel.current?.querySelector<HTMLElement>("button"))?.focus();
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); } };
    const resize = () => close();
    const focus = (e: FocusEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); document.removeEventListener("focusin", focus); window.removeEventListener("resize", resize); };
  }, [open, close]);
  return <>
    <button ref={trigger} type="button" className="btn small" aria-haspopup="dialog" aria-expanded={!!position} onClick={() => {
      const rect = trigger.current!.getBoundingClientRect();
      setPosition(position ? null : { left: rect.left, top: rect.bottom + 4 });
    }}>{label}<ChevronDown className="w-3 h-3" /></button>
    {position && createPortal(<div ref={panel} className="filter-dropdown" role="dialog" aria-label={label} style={position}>
      <div className="dropdown-heading"><b>{label}</b><button type="button" className="row-btn" aria-label={`Close ${label}`} onClick={() => close(true)}><X className="w-3.5 h-3.5" /></button></div>
      {children}
    </div>, document.body)}
  </>;
}
