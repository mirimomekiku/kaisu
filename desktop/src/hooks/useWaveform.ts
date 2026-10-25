import { useEffect, useState } from "react";
import { mediaWaveform, cancelWaveform, errorText, type MediaWaveform } from "../lib/api";
interface Entry { data?: MediaWaveform; promise?: Promise<MediaWaveform>; id: string; users: number }
const cache = new Map<string, Entry>();
export function useWaveform(path: string | undefined, revision: string | undefined, enabled: boolean) {
  const key = `${path}\n${revision ?? ""}`;
  const [result, setResult] = useState<{ key: string; data?: MediaWaveform; error?: string }>({ key: "" });
  useEffect(() => {
    if (!enabled || !path) return;
    let stale = false;
    let entry = cache.get(key);
    if (!entry) { entry = { id: crypto.randomUUID(), users: 0 }; cache.set(key, entry); }
    const current = entry; current.users++;
    if (current.data) setResult({ key, data: current.data });
    else {
      if (!current.promise) current.promise = mediaWaveform(current.id, path).then((wave) => {
        if (!Number.isFinite(wave.duration) || wave.duration <= 0 || !Array.isArray(wave.peaks) || wave.peaks.length === 0 || wave.peaks.length > 768 || wave.peaks.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error("The waveform could not be read.");
        current.data = wave; current.promise = undefined;
        for (const [oldKey, old] of cache) { if (cache.size <= 32) break; if (!old.users && old.data) cache.delete(oldKey); }
        return wave;
      }).catch((error) => { if (cache.get(key) === current) cache.delete(key); throw error; });
      void current.promise.then((data) => { if (!stale) setResult({ key, data }); }, (error) => { if (!stale) setResult({ key, error: errorText(error) }); });
    }
    return () => {
      stale = true; current.users--;
      queueMicrotask(() => { if (!current.users && current.promise && cache.get(key) === current) { cache.delete(key); void cancelWaveform(current.id).catch(() => {}); } });
    };
  }, [path, key, enabled]);
  return enabled && result.key === key ? result : { key };
}
