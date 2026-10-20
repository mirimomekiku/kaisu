import type { HistoryItem, MoveTypes } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Forward slashes, no trailing slash. Windows paths are compared without regard to case. */
export function normalizePath(path: string): string {
  const p = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:/.test(p) ? p.toLowerCase() : p;
}

/** Is `path` the folder `dir` or somewhere below it? */
export function isInside(path: string, dir: string): boolean {
  const d = normalizePath(dir);
  if (!d) return false;
  const p = normalizePath(path);
  return p === d || p.startsWith(`${d}/`);
}

export function typeMatches(item: Pick<HistoryItem, "preset">, types: MoveTypes): boolean {
  return types === "all" || (types === "audio") === (item.preset === "audio");
}

/** Downloads still in the download folder that should go to the other place (not yet moved or copied). */
export function pendingMoves(history: HistoryItem[], outDir: string, types: MoveTypes, exists: Record<string, boolean>): HistoryItem[] {
  return history.filter((h) => !!h.path && !h.transferred && isInside(h.path, outDir) && typeMatches(h, types) && exists[h.path] !== false);
}

/** Downloads older than `days` that lie in one of `dirs` and whose file is still there. */
export function oldDownloads(history: HistoryItem[], days: number, now: number, dirs: string[], exists: Record<string, boolean>): HistoryItem[] {
  if (days <= 0) return [];
  const cutoff = now - days * DAY_MS;
  const real = dirs.filter((d) => d.trim());
  return history.filter((h) => !!h.path && h.timestamp < cutoff && exists[h.path] !== false && real.some((d) => isInside(h.path as string, d)));
}

/** A path after a move: the history entry points at the new place. */
export function withMovedPath(item: HistoryItem, newPath: string): HistoryItem {
  return { ...item, path: newPath };
}

export const DELETE_AFTER_CHOICES = [0, 7, 14, 30, 60, 90, 180, 365];
