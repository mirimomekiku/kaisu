import { useEffect, type Dispatch, type SetStateAction } from "react";

/** Clears a piece of state a while after it was set (banners and short confirmations). */
export function useAutoClear<T>(value: T | null, setValue: Dispatch<SetStateAction<T | null>>, ms: number) {
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setValue(null), ms);
    return () => clearTimeout(timer);
  }, [value, setValue, ms]);
}
