import { useLayoutEffect, useRef, useState } from "react";

/** Which rows of a long, fixed-height list need drawing for the part that is on screen (plus a few either side). */
export function visibleRange(scrollTop: number, viewHeight: number, rowHeight: number, count: number, overscan = 8): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(viewHeight, 0)) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/**
 * Windowing for a long list: only the rows near the viewport are drawn, and spacers above and below keep the scrollbar honest.
 * Put `ref` on the scrolling box, draw rows `start` to `end`, and put `padTop` / `padBottom` around them.
 */
export function useVirtualRows(count: number, rowHeight: number, overscan = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setView((v) => (v.top === el.scrollTop && v.height === (el.clientHeight || 600) ? v : { top: el.scrollTop, height: el.clientHeight || 600 }));
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  }, []);

  const { start, end } = visibleRange(view.top, view.height, rowHeight, count, overscan);
  return { ref, start, end, padTop: start * rowHeight, padBottom: Math.max(0, count - end) * rowHeight };
}
