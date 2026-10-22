export interface MusicPreference { favorite: boolean; rating: number }
export type MusicPreferences = Record<string, MusicPreference>;
export function sanitizeMusicPreferences(raw: unknown): MusicPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).slice(0, 100_000).flatMap(([path, raw]) => {
    if (!path || !raw || typeof raw !== "object") return [];
    const v = raw as Partial<MusicPreference>;
    const rating = typeof v.rating === "number" && Number.isInteger(v.rating) && v.rating >= 0 && v.rating <= 5 ? v.rating : 0;
    return v.favorite === true || rating > 0 ? [[path, { favorite: v.favorite === true, rating }]] : [];
  }));
}
export function setPreference(all: MusicPreferences, path: string, patch: Partial<MusicPreference>): MusicPreferences {
  return sanitizeMusicPreferences({ ...all, [path]: { ...(all[path] ?? { favorite: false, rating: 0 }), ...patch } });
}
export function relocatePreference(all: MusicPreferences, from: string, to: string): MusicPreferences {
  if (from === to || !all[from]) return all;
  const next = { ...all, [to]: { favorite: all[from].favorite || !!all[to]?.favorite, rating: Math.max(all[from].rating, all[to]?.rating ?? 0) } };
  delete next[from]; return next;
}
