import type { PlayerEngine, Track } from "./audioEngine";

// Tells the operating system what is playing, so the keyboard's media keys, the Windows media overlay and headphone buttons
// control Kaisu's player. This is the browser's Media Session API; the web view passes it on to the system.

interface SessionLike {
  metadata: unknown;
  playbackState: string;
  setActionHandler(action: string, handler: ((details: { seekOffset?: number; seekTime?: number }) => void) | null): void;
  setPositionState?(state?: { duration: number; playbackRate: number; position: number }): void;
}

type MetadataCtor = new (init: { title: string; artist: string; album: string; artwork: Array<{ src: string }> }) => unknown;

const ACTIONS = ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward", "seekto", "stop"] as const;

/** Connects `engine` to the system's media controls. Returns a function that disconnects it. */
export function bindMediaSession(
  engine: PlayerEngine,
  session: SessionLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as unknown as { mediaSession?: SessionLike }).mediaSession,
  Metadata: MetadataCtor | undefined = (globalThis as unknown as { MediaMetadata?: MetadataCtor }).MediaMetadata,
): () => void {
  if (!session) return () => {};

  const handlers: Record<(typeof ACTIONS)[number], (d: { seekOffset?: number; seekTime?: number }) => void> = {
    play: () => engine.resume(),
    pause: () => engine.pause(),
    previoustrack: () => engine.previous(),
    nexttrack: () => engine.next(),
    seekbackward: (d) => engine.skip(-(d.seekOffset ?? 10)),
    seekforward: (d) => engine.skip(d.seekOffset ?? 10),
    seekto: (d) => typeof d.seekTime === "number" && engine.seek(d.seekTime),
    stop: () => engine.clear(),
  };
  for (const action of ACTIONS) {
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      // An action this browser doesn't know: carry on with the others.
    }
  }

  let shown: Track | null | undefined;
  const sync = () => {
    const { queue, index, playing } = engine.getState();
    const track = queue[index] ?? null;
    if (track !== shown) {
      shown = track;
      session.metadata = track && Metadata ? new Metadata({ title: track.title, artist: track.artist ?? "", album: track.album ?? "", artwork: track.cover ? [{ src: track.cover }] : [] }) : null;
    }
    session.playbackState = !track ? "none" : playing ? "playing" : "paused";
  };

  let lastReported = "";
  const reportPosition = () => {
    const { position, duration } = engine.getTime();
    if (!session.setPositionState || !(duration > 0) || !Number.isFinite(duration)) return;
    const key = `${Math.floor(position)}/${Math.floor(duration)}/${engine.getState().rate}`;
    if (key === lastReported) return;
    lastReported = key;
    try {
      session.setPositionState({ duration, playbackRate: engine.getState().rate, position: Math.min(position, duration) });
    } catch {
      // Not every browser accepts every value.
    }
  };

  sync();
  const offState = engine.subscribe(() => {
    sync();
    reportPosition();
  });
  const offTime = engine.subscribeTime(reportPosition);

  return () => {
    offState();
    offTime();
    for (const action of ACTIONS) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
    session.metadata = null;
    session.playbackState = "none";
  };
}
