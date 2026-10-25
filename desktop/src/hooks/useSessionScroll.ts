import { useLayoutEffect, useRef, type UIEvent } from "react";
const positions = new Map<string, number>();
export function useSessionScroll(key: string, revision: number) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(key);
  const restored = useRef(false);
  useLayoutEffect(() => {
    const scroller = ref.current?.querySelector<HTMLElement>(".lib-scroll");
    if (previous.current !== key) {
      previous.current = key;
      restored.current = false;
      positions.set(key, 0);
    }
    if (scroller && !restored.current) {
      restored.current = true;
      scroller.scrollTop = positions.get(key) ?? 0;
      scroller.dispatchEvent(new Event("scroll"));
    }
  }, [key, revision]);
  const onScrollCapture = (event: UIEvent<HTMLElement>) => {
    const element = event.target as HTMLElement;
    if (element.classList.contains("lib-scroll")) positions.set(key, element.scrollTop);
  };
  return { ref, onScrollCapture };
}
