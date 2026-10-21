import { describe, expect, it } from "vitest";
import { PlayerEngine, type AudioLike, type Track } from "./audioEngine";
import { bindMediaSession } from "./mediaSession";

class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  duration = NaN;
  paused = true;
  volume = 1;
  playbackRate = 1;
  private l = new Map<string, Set<() => void>>();
  async play() {
    this.paused = false;
    this.fire("playing");
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.fire("pause");
    }
  }
  addEventListener(t: string, f: () => void) {
    (this.l.get(t) ?? this.l.set(t, new Set()).get(t)!).add(f);
  }
  removeEventListener(t: string, f: () => void) {
    this.l.get(t)?.delete(f);
  }
  fire(t: string) {
    this.l.get(t)?.forEach((f) => f());
  }
}

class FakeSession {
  metadata: unknown = null;
  playbackState = "none";
  handlers = new Map<string, ((d: { seekOffset?: number; seekTime?: number }) => void) | null>();
  position: unknown;
  setActionHandler(a: string, h: ((d: { seekOffset?: number; seekTime?: number }) => void) | null) {
    this.handlers.set(a, h);
  }
  setPositionState(s?: unknown) {
    this.position = s;
  }
}
class FakeMetadata {
  constructor(public init: { title: string; artist: string; album: string; artwork: Array<{ src: string }> }) {}
}

const track = (name: string, extra: Partial<Track> = {}): Track => ({ path: `/m/${name}.mp3`, title: name, ...extra });
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup() {
  const audio = new FakeAudio();
  const engine = new PlayerEngine({ audio, resolve: async (t) => `asset://${t.path}`, getPositions: () => ({}), setPositions: () => {} });
  const session = new FakeSession();
  const off = bindMediaSession(engine, session, FakeMetadata);
  return { audio, engine, session, off };
}

describe("bindMediaSession", () => {
  it("tells the system what is playing", async () => {
    const { engine, session } = setup();
    expect(session.playbackState).toBe("none");
    engine.play([track("Song", { artist: "Band", album: "Record", cover: "blob:cover" })]);
    await flush();
    expect(session.playbackState).toBe("playing");
    expect((session.metadata as FakeMetadata).init).toEqual({ title: "Song", artist: "Band", album: "Record", artwork: [{ src: "blob:cover" }] });
    engine.pause();
    expect(session.playbackState).toBe("paused");
  });

  it("changes the title when the track changes, and clears it with the queue", async () => {
    const { engine, session } = setup();
    engine.play([track("One"), track("Two")]);
    await flush();
    engine.next();
    await flush();
    expect((session.metadata as FakeMetadata).init.title).toBe("Two");
    engine.clear();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
  });

  it("lets the media keys control playback", async () => {
    const { engine, session, audio } = setup();
    engine.play([track("One"), track("Two"), track("Three")]);
    await flush();
    session.handlers.get("pause")!({});
    expect(engine.getState().playing).toBe(false);
    session.handlers.get("play")!({});
    await flush();
    expect(engine.getState().playing).toBe(true);
    session.handlers.get("nexttrack")!({});
    await flush();
    expect(engine.getState().index).toBe(1);
    audio.fire("loadedmetadata");
    Object.defineProperty(audio, "duration", { value: 200, configurable: true });
    audio.currentTime = 100;
    session.handlers.get("seekforward")!({ seekOffset: 15 });
    expect(audio.currentTime).toBe(115);
    session.handlers.get("seekbackward")!({});
    expect(audio.currentTime).toBe(105);
    session.handlers.get("seekto")!({ seekTime: 20 });
    expect(audio.currentTime).toBe(20);
    session.handlers.get("seekto")!({});
    expect(audio.currentTime).toBe(20);
    session.handlers.get("previoustrack")!({});
    await flush();
    expect(engine.getState().index).toBe(1);
    expect(audio.currentTime).toBe(0);
    session.handlers.get("stop")!({});
    expect(engine.getState().queue).toEqual([]);
  });

  it("reports the position for the system's seek bar", async () => {
    const { engine, session, audio } = setup();
    engine.play([track("One")]);
    await flush();
    Object.defineProperty(audio, "duration", { value: 240, configurable: true });
    audio.fire("loadedmetadata");
    audio.currentTime = 30;
    audio.fire("timeupdate");
    expect(session.position).toEqual({ duration: 240, playbackRate: 1, position: 30 });
  });

  it("lets go of everything when disconnected", async () => {
    const { engine, session, off } = setup();
    engine.play([track("One")]);
    await flush();
    off();
    expect(session.handlers.get("play")).toBeNull();
    expect(session.metadata).toBeNull();
    engine.pause();
    expect(session.playbackState).toBe("none");
  });

  it("does nothing where there is no media session", () => {
    const audio = new FakeAudio();
    const engine = new PlayerEngine({ audio, resolve: async (t) => t.path, getPositions: () => ({}), setPositions: () => {} });
    expect(() => bindMediaSession(engine, undefined)()).not.toThrow();
  });
});
