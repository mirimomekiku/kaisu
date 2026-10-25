import { useCallback, useEffect, useState } from "react";
import { errorText, fileInfo, openFile, revealFile } from "../lib/api";
import type { HistoryItem } from "../lib/storage";

/**
 * Which downloaded files still exist (re-checked when history changes or a page is opened), plus opening them.
 * A file that turns out to be gone is marked missing straight away.
 */
export function useDownloadedFiles(history: HistoryItem[], page: string, showFlash: (text: string, error?: boolean) => void) {
  const [existing, setExisting] = useState<Record<string, boolean>>({});
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [checkNow, setCheckNow] = useState(0);

  useEffect(() => {
    const paths = [...new Set(history.map((h) => h.path).filter((p): p is string => Boolean(p)))];
    if (paths.length === 0) {
      setExisting({});
      setSizes({});
      return;
    }
    let cancelled = false;
    Promise.all(Array.from({ length: Math.ceil(paths.length / 5000) }, (_, i) => fileInfo(paths.slice(i * 5000, (i + 1) * 5000)))).then((batches) => batches.flat())
      .then((res) => {
        if (cancelled) return;
        setExisting(Object.fromEntries(paths.map((p, i) => [p, res[i].exists])));
        setSizes(Object.fromEntries(paths.flatMap((p, i) => (res[i].exists ? [[p, res[i].size]] : []))));
      })
      .catch((e) => console.warn("file check failed", e));
    return () => {
      cancelled = true;
    };
  }, [history, page, checkNow]);

  const act = useCallback(
    (run: (path: string) => Promise<void>) => (path: string) => {
      run(path).catch((e) => {
        showFlash(errorText(e), true);
        void fileInfo([path]).then(([info]) => {
          if (info) setExisting((prev) => ({ ...prev, [path]: info.exists }));
        }).catch(() => {});
      });
    },
    [showFlash],
  );

  return {
    existing,
    sizes,
    recheck: useCallback(() => setCheckNow((n) => n + 1), []),
    openDownloaded: useCallback((path: string) => act(openFile)(path), [act]),
    revealDownloaded: useCallback((path: string) => act(revealFile)(path), [act]),
  };
}
