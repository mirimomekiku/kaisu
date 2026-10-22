import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { loadMusicPreferences, saveMusicPreferences } from "../lib/storage";
import { relocatePreference, setPreference, type MusicPreference, type MusicPreferences } from "../lib/musicPreferences";
export function useCreateMusicPreferences() {
  const [preferences, setPreferences] = useState<MusicPreferences>({});
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<MusicPreferences>({});
  useEffect(() => { let stale = false; void loadMusicPreferences().then((saved) => { if (!stale) { latest.current = saved; setPreferences(saved); setLoaded(true); } }); return () => { stale = true; }; }, []);
  const commit = useCallback((next: MusicPreferences) => { latest.current = next; setPreferences(next); void saveMusicPreferences(next); }, []);
  const update = useCallback((path: string, patch: Partial<MusicPreference>) => commit(setPreference(latest.current, path, patch)), [commit]);
  const toggleFavorite = useCallback((path: string) => update(path, { favorite: !latest.current[path]?.favorite }), [update]);
  const setRating = useCallback((path: string, rating: number) => update(path, { rating }), [update]);
  const relocate = useCallback((from: string, to: string) => commit(relocatePreference(latest.current, from, to)), [commit]);
  return { preferences, loaded, toggleFavorite, setRating, relocate };
}
export type MusicPreferencesApi = ReturnType<typeof useCreateMusicPreferences>;
export const MusicPreferencesContext = createContext<MusicPreferencesApi | null>(null);
export const useMusicPreferences = () => useContext(MusicPreferencesContext);
