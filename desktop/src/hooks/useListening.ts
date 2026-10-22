import type { Track } from "../lib/audioEngine";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadListening, saveListening } from "../lib/storage";
import { mergeListening, recordListeningTime, recordPlayed, type Listening } from "../lib/listening";

export function useListening() {
  const [stats, setStats] = useState<Listening>({});
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<Listening>({});
  useEffect(() => {
    let stale = false;
    void loadListening().then((saved) => {
      if (stale) return;
      const merged = { ...saved };
      for (const [path, entry] of Object.entries(latest.current)) merged[path] = mergeListening(saved[path], entry);
      latest.current = merged;
      setStats(merged);
      setLoaded(true);
    });
    return () => { stale = true; };
  }, []);
  useEffect(() => { if (loaded) void saveListening(stats); }, [loaded, stats]);
  const record = useCallback((track: Track) => { latest.current = recordPlayed(latest.current, track.path, Date.now(), track); setStats(latest.current); }, []);
  const recordTime = useCallback((track: Track, seconds: number) => { latest.current = recordListeningTime(latest.current, track, seconds); setStats(latest.current); }, []);
  const relocate = useCallback((from: string, to: string) => {
    if (from === to) return;
    const next = { ...latest.current };
    if (next[from]) { next[to] = mergeListening(next[to], next[from]); delete next[from]; }
    latest.current = next; setStats(next);
  }, []);
  return { stats, loaded, record, recordTime, relocate };
}
