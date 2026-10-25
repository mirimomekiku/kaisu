import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { playInApp } from "../lib/api";
import { PlayerEngine, type PlayerState, type PlayerTime, type Track } from "../lib/audioEngine";
import { bindMediaSession } from "../lib/mediaSession";
import { EqualizerGraph } from "../lib/equalizerGraph";
import type { Positions } from "../lib/positions";
import { loadPlayer, loadPositions, savePlayer, savePositions, registerStorageFlush } from "../lib/storage";

const SAVE_DELAY_MS = 1000;
const POSITION_SAVE_EVERY_MS = 5000;

/** The music player, for anything that wants to play, queue or show what is playing. Null before it is created. */
export const PlayerContext = createContext<PlayerEngine | null>(null);
export const usePlayerEngine = () => useContext(PlayerContext);

/** What the player is doing now. The position is separate (`usePlayerTime`), because it changes several times a second. */
export function usePlayerState(engine: PlayerEngine): PlayerState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

export function usePlayerTime(engine: PlayerEngine): PlayerTime {
  return useSyncExternalStore(engine.subscribeTime, engine.getTime);
}

/** Makes a file out of the library or downloads into something the player can queue. */
export const trackFor = (path: string, title: string, extra: Partial<Track> = {}): Track => ({ path, title, ...extra });

/**
 * Creates the player once, connects it to the system's media keys, puts back what was queued last time (paused) and keeps
 * saving the queue and the positions in long files.
 */
export function useCreatePlayer(onPlayed?: (track: Track) => void, onListen?: (track: Track, seconds: number) => void, onRestored?: (notice?: string) => void): PlayerEngine {
  const restoredRef = useRef(onRestored);
  restoredRef.current = onRestored;
  const listenedRef = useRef(onListen);
  listenedRef.current = onListen;
  const playedRef = useRef(onPlayed);
  playedRef.current = onPlayed;
  const positions = useRef<Positions>({});
  const engineRef = useRef<PlayerEngine | null>(null);

  if (engineRef.current === null) {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "metadata";
    engineRef.current = new PlayerEngine({
      audio,
      processing: new EqualizerGraph(),
      createAudio: () => { const next = new Audio(); next.preload = "auto"; next.crossOrigin = "anonymous"; return next; },
      onPlayed: (track) => playedRef.current?.(track),
      onListen: (track, seconds) => listenedRef.current?.(track, seconds),
      resolve: (track) => playInApp(track.path),
      getPositions: () => positions.current,
      setPositions: (next) => {
        positions.current = next;
        void savePositions(next);
      },
    });
  }
  const engine = engineRef.current;

  // The system's media keys and overlay.
  useEffect(() => bindMediaSession(engine), [engine]);

  // Put back what was there last time, then keep saving.
  useEffect(() => {
    let stopped = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTimeSave = 0;
    const offs: Array<() => void> = [];

    const snapshot = () => {
      const { queue, index, volume, rate, repeat, shuffle } = engine.getState();
      return savePlayer(queue.length === 0 ? null : { queue: queue.map(({ cover: _temporary, ...t }) => t), index, position: engine.getTime().position, volume, rate, repeat, shuffle });
    };
    const soon = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(snapshot, SAVE_DELAY_MS);
    };

    (async () => {
      const [savedPositions, saved] = await Promise.all([loadPositions(), loadPlayer()]);
      if (stopped) return;
      positions.current = { ...savedPositions, ...positions.current };
      if (saved && engine.getState().queue.length === 0) {
        engine.applySettings(saved);
        engine.restore(saved.queue, saved.index, saved.position, true);
      }
      let paths = engine.getState().queue.map((t) => t.path);
      offs.push(engine.subscribe(() => {
        const next = engine.getState().queue.map((t) => t.path);
        const changed = next.length !== paths.length || next.some((p, i) => p !== paths[i]);
        paths = next;
        if (changed) snapshot();
        else soon();
      }));
      offs.push(
        engine.subscribeTime(() => {
          const now = Date.now();
          if (now - lastTimeSave >= POSITION_SAVE_EVERY_MS) {
            lastTimeSave = now;
            snapshot();
          }
        }),
      );
      offs.push(registerStorageFlush(async () => {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        await snapshot(); await savePositions(positions.current);
      }));
      restoredRef.current?.(saved?.truncated ? `Restored 2,000 queued tracks around the current song. ${saved.truncated} other tracks were not restored.` : undefined);
    })();

    return () => {
      stopped = true;
      if (saveTimer) clearTimeout(saveTimer);
      offs.forEach((off) => off());
    };
  }, [engine]);

  return engine;
}
