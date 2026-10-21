import { afterEach, describe, expect, it, vi } from "vitest";
import { CANT_PLAY, PlayerEngine, playbackError, type AudioLike, type Track } from "./audioEngine";
import { REMEMBER_FROM_SECONDS, type Positions } from "./positions";

class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  duration = NaN;
  paused = true;
  volume = 1;
  playbackRate = 1;
  playCalls = 0;
  private listeners = new Map<string, Set<() => void>>();
  async play() {
    this.paused = false;
    this.playCalls++;
    this.fire("playing");
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.fire("pause");
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn());
  }
  /** The file has been read: its length is known. */
  loaded(duration: number) {
    this.duration = duration;
    this.fire("loadedmetadata");
  }
  /** Plays to the end. */
  finish() {
    this.paused = true;
    this.fire("pause");
    this.fire("ended");
  }
}

const LONG = REMEMBER_FROM_SECONDS * 3;
const track = (name: string, extra: Partial<Track> = {}): Track => ({ path: `/music/${name}.mp3`, title: name, ...extra });
const A = track("a");
const B = track("b");
const C = track("c");
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function make(initial: Positions = {}, resolve?: (t: Track) => Promise<string>) {
  const audio = new FakeAudio();
  let positions = initial;
  let clock = 1_000_000;
  const resolved: string[] = [];
  const engine = new PlayerEngine({
    audio,
    resolve: resolve ?? (async (t) => (resolved.push(t.path), `asset://${t.path}`)),
    getPositions: () => positions,
    setPositions: (p) => (positions = p),
    now: () => clock,
    random: () => 0.5,
  });
  return { audio, engine, resolved, positions: () => positions, advance: (ms: number) => (clock += ms) };
}

afterEach(() => vi.useRealTimers());

describe("playing", () => {
  it("opens the first track and plays it", async () => {
    const { audio, engine, resolved } = make();
    engine.play([A, B]);
    await flush();
    expect(resolved).toEqual(["/music/a.mp3"]);
    expect(audio.src).toBe("asset:///music/a.mp3");
    expect(audio.playCalls).toBe(1);
    expect(engine.getState()).toMatchObject({ index: 0, playing: true, loading: false });
  });

  it("starts from the chosen track", async () => {
    const { audio, engine } = make();
    engine.play([A, B, C], 2);
    await flush();
    expect(audio.src).toContain("c.mp3");
    expect(engine.getState().index).toBe(2);
  });

  it("toggles between playing and paused", async () => {
    const { audio, engine } = make();
    engine.play([A]);
    await flush();
    engine.toggle();
    expect(engine.getState().playing).toBe(false);
    engine.toggle();
    expect(engine.getState().playing).toBe(true);
    expect(audio.playCalls).toBe(2);
  });

  it("uses only the latest request when two arrive in a row", async () => {
    const releases: Record<string, () => void> = {};
    const { audio, engine } = make({}, (t) => new Promise((r) => (releases[t.path] = () => r(`asset://${t.path}`))));
    engine.play([A]);
    engine.play([B]);
    releases["/music/b.mp3"]();
    await flush();
    releases["/music/a.mp3"]();
    await flush();
    expect(audio.src).toBe("asset:///music/b.mp3");
    expect(audio.playCalls).toBe(1);
  });

  it("says so when the file can't be made available, and tries again on play", async () => {
    let fail = true;
    const { engine } = make({}, async (t) => {
      if (fail) throw "That file isn't in a download folder.";
      return `asset://${t.path}`;
    });
    engine.play([A]);
    await flush();
    expect(engine.getState()).toMatchObject({ error: "That file isn't in a download folder.", loading: false, playing: false });
    fail = false;
    engine.toggle();
    await flush();
    expect(engine.getState()).toMatchObject({ error: null, playing: true });
  });

  it("turns the browser's refusals into plain words, and ignores a replaced request", async () => {
    expect(playbackError({ name: "NotSupportedError", message: "The element has no supported sources." })).toBe(CANT_PLAY);
    expect(playbackError({ name: "AbortError" })).toBeNull();
    expect(playbackError({ name: "NotAllowedError" })).toMatch(/Press play/);
    expect(playbackError("a plain message")).toBe("a plain message");
    expect(playbackError(new Error("boom"))).toBe("boom");

    const { audio, engine } = make();
    audio.play = async () => {
      throw Object.assign(new Error("The element has no supported sources."), { name: "NotSupportedError" });
    };
    engine.play([A]);
    await flush();
    expect(engine.getState()).toMatchObject({ error: CANT_PLAY, playing: false, loading: false });
    // Trying again clears the old message; a request that is only replaced by a newer one shows nothing.
    audio.play = async () => {
      throw Object.assign(new Error("interrupted"), { name: "AbortError" });
    };
    engine.toggle();
    await flush();
    expect(engine.getState().error).toBeNull();
  });

  it("reports a file the player can't decode, but not an empty source", async () => {
    const { audio, engine } = make();
    audio.fire("error");
    expect(engine.getState().error).toBeNull();
    engine.play([A]);
    await flush();
    audio.fire("error");
    expect(engine.getState().error).toMatch(/can't be played here/);
    expect(engine.getState().playing).toBe(false);
  });
});

describe("resuming long files", () => {
  const key = "/music/a.mp3";

  it("carries on from where a long file stopped", async () => {
    const { audio, engine } = make({ [key]: { t: 900, d: LONG, at: 0 } });
    engine.play([A]);
    await flush();
    audio.loaded(LONG);
    expect(audio.currentTime).toBe(900);
  });

  it("starts a song from the top", async () => {
    const { audio, engine } = make({ [key]: { t: 100, d: 200, at: 0 } });
    engine.play([A]);
    await flush();
    audio.loaded(200);
    expect(audio.currentTime).toBe(0);
  });

  it("remembers where a long file was paused, and forgets it once finished", async () => {
    const { audio, engine, positions } = make();
    engine.play([A]);
    await flush();
    audio.loaded(LONG);
    audio.currentTime = 1234;
    engine.pause();
    expect(positions()[key]).toMatchObject({ t: 1234, d: LONG });
    engine.toggle();
    audio.finish();
    expect(positions()[key]).toBeUndefined();
  });

  it("saves every few seconds while playing, not on every tick", async () => {
    const { audio, engine, positions, advance } = make();
    engine.play([A]);
    await flush();
    audio.loaded(LONG);
    audio.currentTime = 100;
    advance(6000);
    audio.fire("timeupdate");
    expect(positions()[key]?.t).toBe(100);
    audio.currentTime = 101;
    advance(1000);
    audio.fire("timeupdate");
    expect(positions()[key]?.t).toBe(100);
  });

  it("saves the position under the track it belongs to when another is started", async () => {
    const { audio, engine, positions } = make();
    engine.play([A]);
    await flush();
    audio.loaded(LONG);
    audio.currentTime = 1000;
    engine.play([B]);
    await flush();
    expect(positions()["/music/a.mp3"]?.t).toBe(1000);
    expect(positions()["/music/b.mp3"]).toBeUndefined();
  });
});

describe("moving around", () => {
  it("goes to the next and previous tracks", async () => {
    const { audio, engine } = make();
    engine.play([A, B, C]);
    await flush();
    engine.next();
    await flush();
    expect(engine.getState().index).toBe(1);
    audio.currentTime = 1;
    engine.previous();
    await flush();
    expect(engine.getState().index).toBe(0);
  });

  it("restarts the track instead when it has been playing a while", async () => {
    const { audio, engine } = make();
    engine.play([A, B]);
    await flush();
    engine.next();
    await flush();
    audio.loaded(200);
    audio.currentTime = 30;
    engine.previous();
    expect(engine.getState().index).toBe(1);
    expect(audio.currentTime).toBe(0);
  });

  it("stays on the last track when there is no next one", async () => {
    const { engine } = make();
    engine.play([A, B], 1);
    await flush();
    engine.next();
    await flush();
    expect(engine.getState().index).toBe(1);
  });

  it("seeks and skips within the file", async () => {
    const { audio, engine } = make();
    engine.play([A]);
    await flush();
    audio.loaded(100);
    engine.seek(40);
    expect(audio.currentTime).toBe(40);
    engine.skip(10);
    expect(audio.currentTime).toBe(50);
    engine.skip(-100);
    expect(audio.currentTime).toBe(0);
    engine.seek(500);
    expect(audio.currentTime).toBe(100);
  });

  it("goes on to the next track by itself, then stops at the end", async () => {
    const { audio, engine } = make();
    engine.play([A, B]);
    await flush();
    audio.finish();
    await flush();
    expect(engine.getState()).toMatchObject({ index: 1, playing: true });
    audio.finish();
    await flush();
    expect(engine.getState()).toMatchObject({ index: 1, playing: false });
  });

  it("repeats the queue or the track", async () => {
    const { audio, engine } = make();
    engine.play([A, B]);
    await flush();
    engine.setRepeat("all");
    engine.next();
    await flush();
    audio.finish();
    await flush();
    expect(engine.getState().index).toBe(0);
    engine.setRepeat("one");
    const plays = audio.playCalls;
    audio.currentTime = 50;
    audio.finish();
    await flush();
    expect(engine.getState().index).toBe(0);
    expect(audio.currentTime).toBe(0);
    expect(audio.playCalls).toBe(plays + 1);
  });
});

describe("speed, volume and levelling", () => {
  it("sets the speed within limits, and keeps it for the next track", async () => {
    const { audio, engine } = make();
    engine.play([A, B]);
    await flush();
    engine.setRate(1.5);
    expect(audio.playbackRate).toBe(1.5);
    engine.setRate(9);
    expect(engine.getState().rate).toBe(2);
    engine.setRate(0.1);
    expect(engine.getState().rate).toBe(0.5);
    engine.setRate(1.25);
    audio.playbackRate = 1; // a browser may reset it when the file changes
    engine.next();
    await flush();
    expect(audio.playbackRate).toBe(1.25);
  });

  it("sets the volume, and makes loud tracks quieter but never louder", () => {
    const { audio, engine } = make();
    engine.setVolume(0.5);
    expect(audio.volume).toBe(0.5);
    engine.setLevelGain(-6.0206);
    expect(audio.volume).toBeCloseTo(0.25, 3);
    engine.setLevelGain(+12);
    expect(audio.volume).toBe(0.5);
    engine.setVolume(7);
    expect(engine.getState().volume).toBe(1);
  });
});

describe("sleep timer", () => {
  it("pauses after the chosen time", async () => {
    vi.useFakeTimers();
    const { engine } = make();
    engine.play([A]);
    await vi.advanceTimersByTimeAsync(5);
    engine.setSleep({ minutes: 15 });
    expect(engine.getState().sleep).toMatchObject({ kind: "timer" });
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(engine.getState().playing).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.getState()).toMatchObject({ playing: false, sleep: null });
  });

  it("can be cancelled, and a new one replaces the old", async () => {
    vi.useFakeTimers();
    const { engine } = make();
    engine.play([A]);
    await vi.advanceTimersByTimeAsync(5);
    engine.setSleep({ minutes: 1 });
    engine.setSleep(null);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(engine.getState().playing).toBe(true);
    engine.setSleep({ minutes: 1 });
    engine.setSleep({ minutes: 10 });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(engine.getState().playing).toBe(true);
  });

  it("stops at the end of the current track without moving on", async () => {
    const { audio, engine } = make();
    engine.play([A, B]);
    await flush();
    engine.setSleep("track");
    audio.finish();
    await flush();
    expect(engine.getState()).toMatchObject({ index: 0, playing: false, sleep: null });
    engine.toggle();
    audio.finish();
    await flush();
    expect(engine.getState().index).toBe(1);
  });
});

describe("the queue", () => {
  it("adds to the end, or right after the current track", async () => {
    const { engine } = make();
    engine.play([A, B]);
    await flush();
    engine.enqueue([C]);
    expect(engine.getState().queue.map((t) => t.title)).toEqual(["a", "b", "c"]);
    engine.playNext([track("x")]);
    expect(engine.getState().queue.map((t) => t.title)).toEqual(["a", "x", "b", "c"]);
  });

  it("sets up a waiting queue when nothing was queued, without playing it", async () => {
    const { audio, engine } = make();
    engine.enqueue([A, B]);
    expect(engine.getState()).toMatchObject({ index: 0, playing: false });
    expect(audio.src).toBe("");
    engine.toggle();
    await flush();
    expect(engine.getState().playing).toBe(true);
    expect(audio.src).toContain("a.mp3");
  });

  it("moves on when the playing track is removed, and keeps its place when another is", async () => {
    const { audio, engine } = make();
    engine.play([A, B, C]);
    await flush();
    engine.remove(2);
    expect(engine.getState().index).toBe(0);
    engine.remove(0);
    await flush();
    expect(audio.src).toContain("b.mp3");
    expect(engine.getState()).toMatchObject({ index: 0, playing: true });
  });

  it("moves tracks without losing the current one", async () => {
    const { engine } = make();
    engine.play([A, B, C]);
    await flush();
    engine.move(0, 2);
    expect(engine.getState().queue.map((t) => t.title)).toEqual(["b", "c", "a"]);
    expect(engine.getState().index).toBe(2);
  });

  it("clears everything and stops", async () => {
    const { audio, engine } = make();
    engine.play([A, B]);
    await flush();
    engine.clear();
    expect(engine.getState()).toMatchObject({ queue: [], index: -1, playing: false });
    expect(audio.src).toBe("");
    audio.fire("error");
    expect(engine.getState().error).toBeNull();
  });

  it("shuffles around the current track and puts the order back", async () => {
    const { engine } = make();
    engine.play([A, B, C], 1);
    await flush();
    engine.toggleShuffle();
    expect(engine.getState().queue[0]).toBe(B);
    expect(engine.getState().index).toBe(0);
    expect(engine.getState().queue).toHaveLength(3);
    engine.enqueue([track("d")]);
    engine.toggleShuffle();
    expect(engine.getState().queue.map((t) => t.title)).toEqual(["a", "b", "c", "d"]);
    expect(engine.getState().index).toBe(1);
  });
});

describe("covers", () => {
  it("learns a track's picture without moving it or losing the queue's order", async () => {
    const { engine } = make();
    engine.play([A, B, C], 1);
    await flush();
    const b = engine.getState().queue[1];
    engine.setCover(b, "blob:cover-b");
    expect(engine.getState().queue.map((t) => t.cover ?? null)).toEqual([null, "blob:cover-b", null]);
    expect(engine.getState().index).toBe(1);
    engine.setCover(engine.getState().queue[1], "blob:cover-b");
    engine.toggleShuffle();
    engine.toggleShuffle();
    expect(engine.getState().queue.map((t) => t.title)).toEqual(["a", "b", "c"]);
    expect(engine.getState().queue[1].cover).toBe("blob:cover-b");
  });
});

describe("a restored queue", () => {
  it("waits, then opens the file at the saved position when play is pressed", async () => {
    const { audio, engine } = make();
    engine.restore([A, B], 1, 42);
    expect(engine.getState()).toMatchObject({ index: 1, playing: false });
    expect(engine.getTime().position).toBe(42);
    expect(audio.src).toBe("");
    engine.toggle();
    await flush();
    audio.loaded(300);
    expect(audio.src).toContain("b.mp3");
    expect(audio.currentTime).toBe(42);
  });

  it("forgets that position when another track is chosen", async () => {
    const { audio, engine } = make();
    engine.restore([A, B], 0, 42);
    engine.jump(1);
    await flush();
    audio.loaded(300);
    expect(audio.currentTime).toBe(0);
  });
});

describe("listening for changes", () => {
  it("tells listeners when the state changes, and stops after unsubscribing", async () => {
    const { engine } = make();
    const seen: number[] = [];
    const off = engine.subscribe(() => seen.push(engine.getState().queue.length));
    engine.enqueue([A]);
    off();
    engine.enqueue([B]);
    expect(seen).toEqual([1]);
  });

  it("keeps the position on its own channel", async () => {
    const { audio, engine } = make();
    let timeChanges = 0;
    let stateChanges = 0;
    engine.play([A]);
    await flush();
    audio.loaded(100);
    engine.subscribeTime(() => timeChanges++);
    engine.subscribe(() => stateChanges++);
    audio.currentTime = 5;
    audio.fire("timeupdate");
    audio.currentTime = 6;
    audio.fire("timeupdate");
    expect(timeChanges).toBe(2);
    expect(stateChanges).toBe(0);
    expect(engine.getTime()).toEqual({ position: 6, duration: 100 });
  });
});
