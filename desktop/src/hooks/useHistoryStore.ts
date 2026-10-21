import { useCallback, useRef, useState } from "react";
import { saveHistory, type HistoryItem } from "../lib/storage";

/** The list of finished downloads, saved whenever it changes. `historyRef` always holds the latest list, for callbacks. */
export function useHistoryStore() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;

  const updateHistory = useCallback((next: HistoryItem[]) => {
    setHistory(next);
    saveHistory(next);
  }, []);

  return { history, historyRef, setHistory, updateHistory };
}
