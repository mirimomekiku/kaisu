// Where playback stopped in long files (a mix, a podcast), so playing them again carries on from there.

/** Only files at least this long are remembered. A song should start from the top. */
export const REMEMBER_FROM_SECONDS = 10 * 60;
/** Playing less than this far in isn't worth resuming. */
const RESUME_AFTER_SECONDS = 5;
/** Within this much of the end counts as finished. */
const FINISHED_WITHIN_SECONDS = 15;
const MAX_ENTRIES = 300;

export interface Position {
  /** Seconds in. */
  t: number;
  /** The file's length. */
  d: number;
  /** When it was saved (ms since 1970), so the oldest can be dropped. */
  at: number;
}
export type Positions = Record<string, Position>;

/** Records where playback is. Short files, the very start and the (nearly) finished end are not kept. */
export function remember(positions: Positions, path: string, t: number, d: number, now = Date.now()): Positions {
  const worthKeeping = Number.isFinite(t) && Number.isFinite(d) && d >= REMEMBER_FROM_SECONDS && t >= RESUME_AFTER_SECONDS && t < d - FINISHED_WITHIN_SECONDS;
  if (!worthKeeping) return forget(positions, path);
  const next: Positions = { ...positions, [path]: { t: Math.floor(t), d: Math.floor(d), at: now } };
  const keys = Object.keys(next);
  if (keys.length <= MAX_ENTRIES) return next;
  // Drop the least recently saved.
  for (const old of keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - MAX_ENTRIES)) delete next[old];
  return next;
}

export function forget(positions: Positions, path: string): Positions {
  if (!(path in positions)) return positions;
  const { [path]: _gone, ...rest } = positions;
  return rest;
}

/** Where to start `path` from, or 0. */
export function resumeAt(positions: Positions, path: string): number {
  const p = positions[path];
  return p && p.d >= REMEMBER_FROM_SECONDS && p.t >= RESUME_AFTER_SECONDS && p.t < p.d - FINISHED_WITHIN_SECONDS ? p.t : 0;
}

/** Settings may hold anything; keep only well-formed entries. */
export function sanitizePositions(raw: unknown): Positions {
  if (!raw || typeof raw !== "object") return {};
  const out: Positions = {};
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as Partial<Position> | null;
    if (p && Number.isFinite(p.t) && Number.isFinite(p.d) && Number.isFinite(p.at)) out[path] = { t: p.t as number, d: p.d as number, at: p.at as number };
  }
  return out;
}
