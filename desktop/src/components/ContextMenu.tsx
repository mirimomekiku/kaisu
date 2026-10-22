import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuEntry =
  | { kind?: "item"; label: string; onSelect: () => void; disabled?: boolean }
  | { kind: "separator" }
  | { kind: "heading"; label: string };

interface Props {
  /** Where the pointer was, in viewport coordinates. */
  x: number;
  y: number;
  label: string;
  items: MenuEntry[];
  onClose: () => void;
}

const EDGE = 6;

/** An Aqua-style context menu: opens at the pointer, stays on screen, and works from the keyboard. */
export default function ContextMenu({ x, y, label, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
  }, [x, y, items]);

  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);

  useEffect(() => {
    buttons()[0]?.focus({ preventScroll: true });
    const close = () => onClose();
    // Layout changes can deliver a pending scroll after opening. Dismiss on user scroll intent instead.
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("wheel", onScroll, { capture: true, passive: true });
    document.addEventListener("touchmove", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("wheel", onScroll, true);
      document.removeEventListener("touchmove", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(e.key)) e.stopPropagation();
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => {
      const button = list[(i + list.length) % list.length];
      const menu = ref.current;
      if (!button || !menu) return;
      button.focus({ preventScroll: true });
      if (button.offsetTop < menu.scrollTop) menu.scrollTop = button.offsetTop;
      else if (button.offsetTop + button.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = button.offsetTop + button.offsetHeight - menu.clientHeight;
    };
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        e.preventDefault();
        focus(at + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focus(at < 0 ? -1 : at - 1);
        break;
      case "Home":
        e.preventDefault();
        focus(0);
        break;
      case "End":
        e.preventDefault();
        focus(-1);
        break;
      case "Tab":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="ctx"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") return <div key={i} role="separator" className="sep" />;
        if (item.kind === "heading")
          return (
            <div key={i} className="heading" aria-hidden="true">
              {item.label}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="label">{item.label}</span>
          </button>
        );
      })}
    </div>, document.body
  );
}
