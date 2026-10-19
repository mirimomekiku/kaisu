import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelDownload,
  errorText,
  startDownload,
  type DownloadEvent,
  type ExtraOptions,
  type Preset,
} from "../lib/api";

export type DownloadStatus = "queued" | "downloading" | "processing" | "completed" | "error" | "cancelled";

export interface DownloadItem {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  preset: Preset;
  outDir: string;
  extra: ExtraOptions;
  status: DownloadStatus;
  progress: number;
  speed: number | null;
  eta: number | null;
  path: string | null;
  errorMsg?: string;
  /** Recent yt-dlp output, newest last (capped). */
  log: string[];
}

export interface EnqueueInput {
  url: string;
  title: string;
  thumbnail: string;
  preset: Preset;
  outDir: string;
  extra: ExtraOptions;
}

const MAX_LOG_LINES = 400;

const isActive = (s: DownloadStatus) => s === "downloading" || s === "processing";
const isFinished = (s: DownloadStatus) => s === "completed" || s === "error" || s === "cancelled";

let nextId = 0;
const newId = () => `${Date.now().toString(36)}-${(nextId++).toString(36)}`;

/** Download queue. Items wait as "queued" until a slot (`concurrency`) frees up. */
export function useDownloads(concurrency: number, onCompleted: (item: DownloadItem) => void) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const started = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const patch = useCallback((id: string, update: (item: DownloadItem) => Partial<DownloadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id && !isFinished(it.status) ? { ...it, ...update(it) } : it)));
  }, []);

  const handleEvent = useCallback(
    (id: string, e: DownloadEvent) => {
      switch (e.kind) {
        case "progress":
          patch(id, (it) => ({
            status: "downloading",
            progress: Math.max(it.progress, e.pct),
            speed: e.speed,
            eta: e.eta,
          }));
          break;
        case "log":
          patch(id, (it) => ({ log: [...it.log, e.line].slice(-MAX_LOG_LINES) }));
          break;
        case "processing":
          patch(id, () => ({ status: "processing", progress: 99, speed: null, eta: null }));
          break;
        case "done": {
          const done = itemsRef.current.find((it) => it.id === id);
          patch(id, () => ({ status: "completed", progress: 100, speed: null, eta: null, path: e.path }));
          if (done && !isFinished(done.status)) onCompletedRef.current({ ...done, path: e.path });
          break;
        }
        case "cancelled":
          patch(id, () => ({ status: "cancelled", speed: null, eta: null }));
          break;
        case "error":
          patch(id, () => ({ status: "error", speed: null, eta: null, errorMsg: e.message }));
          break;
      }
    },
    [patch],
  );

  // Scheduler: start queued items while there are free slots.
  useEffect(() => {
    const running = items.filter((it) => isActive(it.status)).length;
    const free = Math.max(0, concurrency - running);
    if (free === 0) return;

    // `items` is newest-first, so the oldest queued item is last.
    const toStart = items
      .filter((it) => it.status === "queued" && !started.current.has(it.id))
      .reverse()
      .slice(0, free);
    if (toStart.length === 0) return;

    for (const it of toStart) started.current.add(it.id);
    const ids = new Set(toStart.map((it) => it.id));
    setItems((prev) => prev.map((it) => (ids.has(it.id) ? { ...it, status: "downloading" } : it)));

    for (const it of toStart) {
      startDownload(
        { id: it.id, url: it.url, preset: it.preset, out_dir: it.outDir, extra: it.extra },
        (e) => handleEvent(it.id, e),
      ).catch((err) => handleEvent(it.id, { kind: "error", message: errorText(err) }));
    }
  }, [items, concurrency, handleEvent]);

  const enqueue = useCallback((input: EnqueueInput) => {
    const item: DownloadItem = {
      ...input,
      id: newId(),
      status: "queued",
      progress: 0,
      speed: null,
      eta: null,
      path: null,
      log: [],
    };
    setItems((prev) => [item, ...prev]);
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((x) => x.id === id);
      if (!it) return;
      if (it.status === "queued") {
        started.current.add(id);
        patch(id, () => ({ status: "cancelled" }));
      } else {
        cancelDownload(id).catch((e) => console.warn("cancel failed", e));
      }
    },
    [patch],
  );

  const retry = useCallback((id: string) => {
    started.current.delete(id);
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && (it.status === "error" || it.status === "cancelled")
          ? { ...it, status: "queued", progress: 0, speed: null, eta: null, errorMsg: undefined, log: [] }
          : it,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id || !isFinished(it.status)));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => !isFinished(it.status)));
  }, []);

  const hasActive = items.some((it) => isActive(it.status) || it.status === "queued");

  return { items, enqueue, cancel, retry, remove, clearFinished, hasActive };
}
