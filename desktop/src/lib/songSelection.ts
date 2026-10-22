export interface SongSelection { paths: Set<string>; anchor: string | null }
export const emptySelection = (): SongSelection => ({ paths: new Set(), anchor: null });

/** Ranges use the current filtered/sorted order, including rows outside the virtual viewport. */
export function selectSong(state: SongSelection, order: string[], path: string, options: { range?: boolean; toggle?: boolean; additive?: boolean } = {}): SongSelection {
  const at = order.indexOf(path);
  if (at < 0) return state;
  const anchor = state.anchor === null ? -1 : order.indexOf(state.anchor);
  if (options.range && anchor >= 0) {
    const range = order.slice(Math.min(anchor, at), Math.max(anchor, at) + 1);
    return { paths: new Set(options.additive ? [...state.paths, ...range] : range), anchor: state.anchor };
  }
  const paths = options.toggle || options.additive ? new Set(state.paths) : new Set<string>();
  if (options.toggle && paths.has(path)) paths.delete(path); else paths.add(path);
  return { paths, anchor: path };
}

export function pruneSelection(state: SongSelection, visible: Set<string>): SongSelection {
  const anchor = state.anchor !== null && visible.has(state.anchor) ? state.anchor : null;
  if (anchor === state.anchor && [...state.paths].every((path) => visible.has(path))) return state;
  return { paths: new Set([...state.paths].filter((path) => visible.has(path))), anchor };
}
