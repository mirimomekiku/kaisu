// Volume leveling: songs measured louder than the target are played a little quieter, so a playlist doesn't jump around.

/** Where songs are brought to, in LUFS. Streaming services use about -14 to -16; this leaves headroom since we never boost. */
export const TARGET_LUFS = -16;
/** However loud a song is, it is never turned down by more than this (decibels). */
export const MAX_CUT_DB = 20;

/** How many decibels to take off a song measured at `lufs`: never positive (no boosting), 0 when it isn't known or leveling is off. */
export function levelGain(lufs: number | null | undefined, enabled: boolean): number {
  if (!enabled || lufs == null || !Number.isFinite(lufs)) return 0;
  return -Math.min(MAX_CUT_DB, Math.max(0, lufs - TARGET_LUFS));
}

/** Songs in `tracks` that haven't been measured yet. */
export function unmeasured<T extends { path: string; loudness: number | null; missing?: boolean }>(tracks: T[]): string[] {
  return tracks.filter((t) => !t.missing && t.loudness == null).map((t) => t.path);
}
