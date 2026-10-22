import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { fileUrl, playInApp } from "../lib/api";
import { PlayerEngine, type PlayerState, type PlayerTime, type Track } from "../lib/audioEngine";
import { bindMediaSession } from "../lib/mediaSession";
import type { Positions } from "../lib/positions";
import { loadPlayer, loadPositions, savePlayer, savePositions } from "../lib/storage";

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
export function useCreatePlayer(onPlayed?: (track: Track) => void, onListen?: (track: Track, seconds: number) => void): PlayerEngine {
  const listenedRef = useRef(onListen);
  listenedRef.current = onListen;
  const playedRef = useRef(onPlayed);
  playedRef.current = onPlayed;
  const positions = useRef<Positions>({});
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const engineRef = useRef<PlayerEngine | null>(null);

  if (engineRef.current === null) {
    const audio = new Audio();
    audio.preload = "metadata";
    engineRef.current = new PlayerEngine({
      audio,
      createAudio: () => { const next = new Audio(); next.preload = "auto"; return next; },
      onPlayed: (track) => playedRef.current?.(track),
      onListen: (track, seconds) => listenedRef.current?.(track, seconds),
      resolve: async (track) => {
        await playInApp(track.path);
        return fileUrl(track.path);
      },
      getPositions: () => positions.current,
      setPositions: (next) => {
        positions.current = next;
        if (positionTimer.current === null) {
          positionTimer.current = setTimeout(() => {
            positionTimer.current = null;
            void savePositions(positions.current);
          }, SAVE_DELAY_MS);
        }
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
      void savePlayer(queue.length === 0 ? null : { queue: queue.map(({ cover: _temporary, ...t }) => t), index, position: engine.getTime().position, volume, rate, repeat, shuffle });
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
        engine.restore(saved.queue, saved.index, saved.position);
      }
      offs.push(engine.subscribe(soon));
      offs.push(
        engine.subscribeTime(() => {
          const now = Date.now();
          if (now - lastTimeSave >= POSITION_SAVE_EVERY_MS) {
            lastTimeSave = now;
            snapshot();
          }
        }),
      );
    })();

    return () => {
      stopped = true;
      if (saveTimer) clearTimeout(saveTimer);
      offs.forEach((off) => off());
    };
  }, [engine]);

  return engine;
}
