import { useCallback, useState } from "react";
const values = new Map<string, unknown>();
/** View preferences survive navigation without writing personal searches to disk. */
export function useSessionState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => values.has(key) ? values.get(key) as T : initial);
  const change = useCallback((next: T | ((old: T) => T)) => {
    setValue((old) => { const value = typeof next === "function" ? (next as (old: T) => T)(old) : next; values.set(key, value); return value; });
  }, [key]);
  return [value, change] as const;
}
