import { afterEach, describe, expect, it, vi } from "vitest";
import { CANT_PLAY, PlayerEngine, playbackError, type AudioLike, type Track } from "./audioEngine";
import { REMEMBER_FROM_SECONDS, type Positions } from "./positions";

class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  duration = NaN;
  paused = true;
  volume = 1;
  muted = false;
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

function make(initial: Positions = {}, resolve?: (t: Track) => Promise<string>, onPlayed?: (t: Track) => void, onListen?: (t: Track, seconds: number) => void) {
  const audio = new FakeAudio();
  let positions = initial;
  let clock = 1_000_000;
  const resolved: string[] = [];
  const engine = new PlayerEngine({
    audio,
    onPlayed,
    onListen,
    resolve: resolve ?? (async (t) => (resolved.push(t.path), `asset://${t.path}`)),
    getPositions: () => positions,
    setPositions: (p) => (positions = p),
    now: () => clock,
    random: () => 0.5,
  });
  return { audio, engine, resolved, positions: () => positions, advance: (ms: number) => (clock += ms) };
}

afterEach(() => vi.useRealTimers());

describe("queue selection edits and undo", () => {
  it("removes only the selected duplicate occurrence and keeps the playing copy", async () => {
    const { engine, audio, resolved } = make();
    engine.play([A, A, B], 1); await flush(); audio.loaded(120); audio.currentTime = 23;
    const keys = engine.getState().queueKeys;
    expect(new Set(keys).size).toBe(3);
    engine.removeMany([keys[0]]);
    expect(engine.getState().queueKeys).toEqual([keys[1], keys[2]]);
    engine.undoQueue();
    expect(engine.getState()).toMatchObject({ queueKeys: keys, index: 1, playing: true });
    expect(audio.currentTime).toBe(23); expect(resolved).toHaveLength(1); engine.dispose();
  });
  it("moves a selection and undoes it without reloading the playing track", async () => {
    const { engine, audio, resolved } = make();
    engine.play([A, B, C], 1); await flush(); audio.loaded(120); audio.currentTime = 14;
    const keys = engine.getState().queueKeys;
    engine.moveMany([keys[1], keys[2]], 0);
    expect(engine.getState()).toMatchObject({ queue: [B, C, A], index: 0 });
    engine.undoQueue();
    expect(engine.getState()).toMatchObject({ queue: [A, B, C], index: 1, playing: true });
    expect(audio.currentTime).toBe(14); expect(resolved).toHaveLength(1); engine.dispose();
  });
  it("removes the current selection once and undo preserves the successor's playback", async () => {
    const { engine, audio, resolved } = make();
    engine.play([A, B, C]); await flush();
    engine.removeMany(engine.getState().queueKeys.slice(0, 2)); await flush();
    audio.loaded(120); audio.currentTime = 9;
    expect(engine.getState()).toMatchObject({ queue: [C], index: 0, playing: true });
    engine.undoQueue();
    expect(engine.getState()).toMatchObject({ queue: [A, B, C], index: 2, playing: true });
    expect(audio.currentTime).toBe(9); expect(resolved).toEqual([A.path, C.path]); engine.dispose();
  });
  it("restores a cleared queue paused at its exact short-track position", async () => {
    const { engine, audio } = make();
    engine.play([A, B], 1); await flush(); audio.loaded(120); audio.currentTime = 34;
    const keys = engine.getState().queueKeys;
    engine.clear(); expect(engine.getState().queue).toEqual([]);
    engine.undoQueue();
    expect(engine.getState()).toMatchObject({ queue: [A, B], queueKeys: keys, index: 1, playing: false });
    expect(engine.getTime().position).toBe(34);
    engine.toggle(); await flush(); audio.loaded(120);
    expect(audio.currentTime).toBe(34); expect(engine.getState().playing).toBe(true); engine.dispose();
  });
  it("restores duplicate membership and original order after shuffled edits", async () => {
    const { engine } = make();
    engine.play([A, A, B, C], 1); await flush();
    const keys = engine.getState().queueKeys;
    engine.toggleShuffle();
    engine.removeMany([keys[0], keys[2]]);
    engine.undoQueue(); engine.toggleShuffle();
    expect(engine.getState()).toMatchObject({ queueKeys: keys, index: 1 }); engine.dispose();
  });
  it("updates paths and metadata for entries removed into history", () => {
    const { engine } = make();
    engine.restore([A, B], 0, 0); engine.remove(1);
    engine.replacePath(B.path, "/moved/b.mp3");
    engine.updateTrackDetails([{ ...B, path: "/moved/b.mp3", title: "Renamed" }]);
    engine.undoQueue();
    expect(engine.getState().queue[1]).toMatchObject({ path: "/moved/b.mp3", title: "Renamed" }); engine.dispose();
  });
  it("ignores stale keys and invalid gaps; additions reset undo", () => {
    const { engine } = make(); engine.restore([A, B, C], 0, 0);
    engine.removeMany(["missing"]); engine.moveMany(engine.getState().queueKeys, NaN);
    expect(engine.getState().queueUndoLabel).toBeNull();
    engine.remove(2); engine.enqueue([C]); engine.undoQueue();
    expect(engine.getState().queue).toEqual([A, B, C]);
    expect(engine.getState().queueUndoLabel).toBeNull(); engine.dispose();
  });
  it("caps history at twenty edits", () => {
    const { engine } = make(); engine.restore([A, B, C], 0, 0);
    for (let i = 0; i < 22; i++) engine.move(0, 1);
    for (let i = 0; i < 20; i++) engine.undoQueue();
    expect(engine.getState().queueUndoLabel).toBeNull();
    expect(engine.getState().queue).toEqual([A, B, C]); engine.dispose();
  });
  it("does not start a late source after clearing and undoing a pending load", async () => {
    let resolve!: (source: string) => void;
    const { engine, audio } = make({}, () => new Promise((r) => { resolve = r; }));
    engine.play([A, B]); await flush(); engine.clear(); engine.undoQueue();
    resolve("asset://late"); await flush();
    expect(audio.playCalls).toBe(0); expect(engine.getState()).toMatchObject({ playing: false, loading: false, queue: [A, B] }); engine.dispose();
  });
});

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
  it("initializes the audio element at 100% and unmuted", () => {
    const audio = new FakeAudio();
    audio.volume = 0;
    audio.muted = true;
    const engine = new PlayerEngine({ audio, resolve: async () => "audio", getPositions: () => ({}), setPositions: () => {} });
    expect(engine.getState().volume).toBe(1);
    expect(audio.volume).toBe(1);
    expect(audio.muted).toBe(false);
    engine.dispose();
  });

  it.each([1, 0.4, 0])("synchronizes a newly started output at volume %s without touching the slider", async (volume) => {
    const { audio, engine } = make();
    engine.applySettings({ volume, rate: 1, repeat: "off", shuffle: false });
    engine.setLevelGain(-6.0206);
    const originalPlay = audio.play.bind(audio);
    audio.play = async () => { audio.volume = 0; audio.muted = true; await originalPlay(); };
    engine.play([A, B]);
    await flush();
    expect(audio.volume).toBeCloseTo(volume / 2, 5);
    expect(audio.muted).toBe(false);
    expect(engine.getState().volume).toBe(volume);
    // Native output initialization can also report zero after "playing".
    audio.volume = 0;
    audio.muted = true;
    audio.fire("volumechange");
    expect(audio.volume).toBeCloseTo(volume / 2, 5);
    expect(audio.muted).toBe(false);
    engine.toggle();
    engine.toggle();
    await flush();
    expect(audio.volume).toBeCloseTo(volume / 2, 5);
    engine.next();
    await flush();
    expect(audio.volume).toBeCloseTo(volume / 2, 5);
    engine.dispose();
  });

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

describe("listening and relocation", () => {
  it("records completion, including repeat, without counting pauses or skips", async () => {
    const played = vi.fn();
    const { engine, audio } = make({}, undefined, played);
    engine.play([A, B]); await flush();
    engine.toggle(); engine.toggle();
    expect(played).not.toHaveBeenCalled();
    engine.next(); await flush();
    expect(played).not.toHaveBeenCalled();
    engine.setRepeat("one");
    audio.finish(); audio.finish();
    expect(played.mock.calls.map(([t]) => t.path)).toEqual([B.path, B.path]);
  });
  it("updates queued paths and resume positions without restarting audio", async () => {
    const initial = { [B.path]: { t: 50, d: LONG, at: 123 } };
    const { engine, audio, positions } = make(initial);
    engine.play([A, B]); await flush();
    const count = audio.playCalls;
    engine.replacePath(B.path, "/new/b.mp3");
    expect(audio.playCalls).toBe(count);
    expect(engine.getState().queue[1].path).toBe("/new/b.mp3");
    expect(positions()).toEqual({ "/new/b.mp3": initial[B.path] });
    engine.next(); await flush();
    expect(audio.src).toContain("/new/b.mp3");
  });
});

describe("measured listening time", () => {
  it("counts real playback and flushes partial plays on pause, without counting seeks or paused time", async () => {
    const listened = vi.fn();
    const { engine, audio, advance } = make({}, undefined, undefined, listened);
    engine.play([A, B]); await flush(); audio.loaded(300);
    advance(2000); audio.currentTime = 2; audio.fire("timeupdate");
    engine.pause();
    expect(listened.mock.calls.map(([, seconds]) => seconds)).toEqual([2]);
    advance(10000); audio.fire("timeupdate");
    engine.seek(100); engine.resume();
    advance(3000); audio.currentTime = 103; audio.fire("timeupdate"); engine.pause();
    expect(listened.mock.calls.map(([, seconds]) => seconds)).toEqual([2, 3]);
  });
  it("excludes buffering and suspended clock gaps and handles playback speed", async () => {
    const listened = vi.fn();
    const { engine, audio, advance } = make({}, undefined, undefined, listened);
    engine.play([A]); await flush(); audio.loaded(300);
    engine.setRate(2); advance(2000); audio.currentTime = 4; audio.fire("timeupdate");
    audio.fire("waiting");
    advance(10000); audio.fire("timeupdate"); audio.fire("playing");
    advance(2000); audio.currentTime = 8; audio.fire("timeupdate");
    advance(60000); audio.currentTime = 128; audio.fire("timeupdate"); engine.pause();
    expect(listened.mock.calls.reduce((sum, [, seconds]) => sum + seconds, 0)).toBe(4);
  });
  it("attributes time to the previous track before switching or clearing", async () => {
    const listened = vi.fn();
    const { engine, audio, advance } = make({}, undefined, undefined, listened);
    engine.play([A, B]); await flush();
    advance(1000); audio.currentTime = 1; engine.next(); await flush();
    audio.currentTime = 0; audio.fire("playing");
    advance(2000); audio.currentTime = 2; engine.clear();
    expect(listened.mock.calls.map(([t, seconds]) => [t.path, seconds])).toEqual([[A.path, 1], [B.path, 2]]);
  });
});

const settleTransitions = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function seamless(seconds = 0) {
  const audios: FakeAudio[] = [new FakeAudio()];
  let clock = 10000;
  let positions: Positions = {};
  const resolved: string[] = [];
  const played = vi.fn(); const listened = vi.fn();
  const engine = new PlayerEngine({ audio: audios[0], createAudio: () => { const a = new FakeAudio(); audios.push(a); return a; }, resolve: async (t) => { resolved.push(t.path); return t.path; }, getPositions: () => positions, setPositions: (p) => { positions = p; }, now: () => clock, onPlayed: played, onListen: listened });
  engine.setTransitions(true, seconds);
  return { engine, audios, resolved, played, listened, advance: (ms: number) => { clock += ms; }, ready: (a: FakeAudio, duration = 10) => { a.loaded(duration); a.fire("canplay"); } };
}
describe("preloaded transitions", () => {
  it("prepares without playing and advances without resolving the next source twice", async () => {
    const { engine, audios, ready, resolved, played } = seamless();
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    expect(audios[1].playCalls).toBe(0); expect(audios[1].volume).toBe(0);
    expect(engine.getState().index).toBe(0);
    audios[0].finish(); await settleTransitions();
    expect(engine.getState()).toMatchObject({ index: 1, playing: true });
    expect(audios[1].playCalls).toBe(1); expect(resolved.filter((p) => p === B.path)).toHaveLength(1);
    expect(played.mock.calls.map(([t]) => t.path)).toEqual([A.path]);
    expect(audios[0].src).toBe(""); engine.dispose();
  });
  it("crossfades with complementary gains, pauses both decks and counts an outgoing completion once", async () => {
    vi.useFakeTimers();
    const { engine, audios, ready, played, advance, listened } = seamless(3);
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    advance(7000); audios[0].currentTime = 7; audios[0].fire("timeupdate"); await settleTransitions();
    expect(engine.getState().index).toBe(1); expect(played).not.toHaveBeenCalled();
    expect(audios[0].volume).toBe(1); expect(audios[1].volume).toBe(0);
    advance(1500); audios[0].currentTime = 8.5; audios[1].currentTime = 1.5; vi.advanceTimersByTime(40);
    expect(audios[0].volume).toBeCloseTo(0.5); expect(audios[1].volume).toBeCloseTo(0.5);
    engine.pause(); expect(audios.every((a) => a.paused)).toBe(true);
    engine.resume(); await settleTransitions(); expect(audios[0].paused).toBe(false); expect(audios[1].paused).toBe(false);
    advance(1500); audios[0].currentTime = 10; audios[1].currentTime = 3; vi.advanceTimersByTime(40); audios[0].finish();
    expect(audios[1].volume).toBe(1); expect(played.mock.calls.map(([t]) => t.path)).toEqual([A.path]);
    engine.pause();
    expect(listened.mock.calls.reduce((sum, [, n]) => sum + n, 0)).toBeCloseTo(10, 1);
    engine.dispose();
  });
  it("uses each track's loudness gain during a fade and honors global volume", async () => {
    vi.useFakeTimers();
    const { engine, audios, ready, advance } = seamless(2);
    engine.setLevelMap(new Map([[B.path, -12]])); engine.setLevelGain(-6); engine.setVolume(0.5);
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
    advance(1000); audios[0].currentTime = 9; audios[1].currentTime = 1; vi.advanceTimersByTime(40);
    expect(audios[0].volume).toBeCloseTo(0.25 * Math.pow(10, -6 / 20));
    expect(audios[1].volume).toBeCloseTo(0.25 * Math.pow(10, -12 / 20));
    engine.setVolume(0); expect(audios[0].volume + audios[1].volume).toBe(0); engine.dispose();
  });
  it("discards stale preloads when play-next changes the successor", async () => {
    const { engine, audios, ready } = seamless();
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    const stale = audios[1]; engine.playNext([C]); await settleTransitions(); ready(audios[2]);
    expect(stale.src).toBe(""); stale.fire("canplay"); stale.finish();
    expect(engine.getState().index).toBe(0);
    audios[0].finish(); await settleTransitions(); expect(engine.current?.path).toBe(C.path); engine.dispose();
  });
  it("does not overlap sleep-after-track or repeat-one", async () => {
    const { engine, audios, ready, played } = seamless(3);
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    engine.setSleep("track"); audios[0].currentTime = 9; audios[0].fire("timeupdate");
    expect(audios[1].playCalls).toBe(0); audios[0].finish(); await settleTransitions();
    expect(engine.getState().playing).toBe(false); expect(engine.getState().index).toBe(0);
    engine.setRepeat("one"); engine.resume(); await settleTransitions(); audios[0].finish(); await settleTransitions();
    expect(engine.current?.path).toBe(A.path); expect(played).toHaveBeenCalledTimes(2); engine.dispose();
  });
  it("keeps the outgoing song alive when the next deck cannot start", async () => {
    const { engine, audios, ready } = seamless(3);
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    audios[1].play = async () => { throw new Error("decoder refused"); };
    audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
    expect(engine.current?.path).toBe(A.path); expect(engine.getState()).toMatchObject({ playing: true, error: null });
    expect(audios[0].paused).toBe(false); audios[0].finish(); await settleTransitions();
    expect(engine.current?.path).toBe(B.path); engine.dispose();
  });
  it("stops the outgoing tail on seek, queue replacement and clear", async () => {
    const { engine, audios, ready, played } = seamless(3);
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
    engine.seek(5); expect(audios[0].src).toBe(""); expect(audios[1].volume).toBe(1); expect(played).not.toHaveBeenCalled();
    engine.clear(); expect(audios.every((a) => a.paused && a.src === "")).toBe(true); engine.dispose();
  });
  it("releases open files for artwork editing and resumes at the saved point", async () => {
    const { engine, audios, ready } = seamless(); engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    audios[0].currentTime = 4; const release = engine.releaseFiles([A.path, B.path]);
    expect(audios.every((a) => a.src === "")).toBe(true); expect(engine.getState().playing).toBe(false);
    engine.resume(); await settleTransitions(); expect(engine.getState().playing).toBe(false); release(); engine.resume(); await settleTransitions(); ready(audios[0]); expect(audios[0].currentTime).toBe(4); engine.dispose();
  });
});

it("does not restart a canceled promotion after pause", async () => {
  const { engine, audios, ready } = seamless(3); engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
  let release!: () => void; const play = audios[1].play.bind(audios[1]);
  audios[1].play = async () => { await play(); await new Promise<void>((resolve) => { release = resolve; }); };
  audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
  engine.pause(); release(); await settleTransitions();
  expect(engine.current?.path).toBe(A.path); expect(engine.getState().playing).toBe(false); expect(audios.every((a) => a.paused)).toBe(true); engine.dispose();
});
it("preloads the first song at the end of a repeating queue", async () => {
  const { engine, audios, ready, played } = seamless(); engine.setRepeat("all"); engine.play([A, B], 1); await settleTransitions(); ready(audios[0]); ready(audios[1]);
  audios[0].finish(); await settleTransitions(); expect(engine.current?.path).toBe(A.path); expect(played.mock.calls[0][0].path).toBe(B.path); engine.dispose();
});
it("cancels both a prepared successor and an active overlap when transitions are disabled", async () => {
  const { engine, audios, ready } = seamless(3); engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
  audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions(); engine.setTransitions(false, 3);
  expect(audios[0].paused).toBe(true); expect(audios[1].volume).toBe(1); expect(engine.current?.path).toBe(B.path); engine.dispose();
});

it("a pending source cannot reopen a file after it is released for editing", async () => {
  let resolve!: (src: string) => void;
  const { engine, audio } = make({}, () => new Promise<string>((r) => { resolve = r; }));
  engine.play([A]); const release = engine.releaseFiles([A.path]); resolve("late-source"); await settleTransitions();
  expect(audio.src).toBe(""); expect(audio.playCalls).toBe(0); expect(engine.getState().playing).toBe(false); release(); engine.dispose();
});

it("removing a loading track discards its late source and leaves the replacement ready to resume", async () => {
  let resolve!: (src: string) => void;
  const { engine, audio } = make({}, (t) => t === A ? new Promise<string>((r) => { resolve = r; }) : Promise.resolve("source-for-B"));
  try {
    engine.play([A, { ...B, duration: 42 }]);
    engine.remove(0);
    resolve("source-for-A"); await settleTransitions();
    expect(engine.current?.path).toBe(B.path);
    expect(audio.src).toBe(""); expect(audio.playCalls).toBe(0);
    expect(engine.getState()).toMatchObject({ playing: false, loading: false, error: null, duration: 42 });
    expect(engine.getTime()).toEqual({ position: 0, duration: 42 });
    engine.resume(); await settleTransitions();
    expect(audio.src).toBe("source-for-B"); expect(audio.playCalls).toBe(1);
    expect(engine.getState()).toMatchObject({ playing: true, loading: false });
  } finally { engine.dispose(); }
});

it("releasing only the current file cancels a pending crossfade and preserves its resume position", async () => {
  const { engine, audios, ready } = seamless(3);
  let releaseFile: (() => void) | undefined;
  try {
    engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
    let releasePlay!: () => void; const play = audios[1].play.bind(audios[1]);
    audios[1].play = async () => { await play(); await new Promise<void>((r) => { releasePlay = r; }); };
    audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
    releaseFile = engine.releaseFiles([A.path]); releasePlay(); await settleTransitions();
    expect(engine.current?.path).toBe(A.path);
    expect(engine.getState()).toMatchObject({ playing: false, loading: false });
    expect(audios.every((a) => a.paused && a.src === "")).toBe(true);
    engine.resume(); await settleTransitions(); expect(engine.getState().playing).toBe(false);
    releaseFile(); releaseFile = undefined;
    engine.resume(); await settleTransitions(); ready(audios[0]);
    expect(engine.current?.path).toBe(A.path); expect(audios[0].currentTime).toBe(8);
    expect(engine.getState().playing).toBe(true);
  } finally { releaseFile?.(); engine.dispose(); }
});

describe("playback cancellation and recovery", () => {
  it("does not surface a pending play rejection after the user pauses", async () => {
    const { engine, audio } = make(); let reject!: (error: Error) => void;
    audio.play = () => new Promise<void>((_, r) => { reject = r; });
    try {
      engine.play([A]); await flush(); engine.pause(); reject(new Error("decoder cancelled")); await flush();
      expect(engine.getState()).toMatchObject({ phase: "paused", error: null, loading: false });
    } finally { engine.dispose(); }
  });
  it("keeps an explicit seek to zero while a long track is still loading", async () => {
    let release!: (src: string) => void;
    const { engine, audio } = make({ [A.path]: { t: 50, d: 900, at: 1 } }, () => new Promise<string>((r) => { release = r; }));
    try {
      engine.play([{ ...A, duration: 900 }]); engine.seek(0); release("source"); await flush(); audio.loaded(900);
      expect(audio.currentTime).toBe(0); expect(engine.getTime().position).toBe(0);
    } finally { engine.dispose(); }
  });
  it("normalizes malformed restored controls and queue indices", () => {
    const { engine, audio } = make();
    try {
      engine.restore([A, B], NaN, Infinity); engine.applySettings({ volume: NaN, rate: Infinity, repeat: "off", shuffle: false });
      engine.jump(0.5); engine.remove(NaN); engine.move(NaN, 1);
      expect(engine.getState()).toMatchObject({ index: 0, volume: 1, rate: 1 }); expect(engine.getTime().position).toBe(0);
      expect(audio.volume).toBe(1); expect(audio.playbackRate).toBe(1);
    } finally { engine.dispose(); }
  });
  it("pauses an unresolved source, ignores its late result and resumes explicitly", async () => {
    let release!: (src: string) => void; let count = 0;
    const { engine, audio } = make({}, () => ++count === 1 ? new Promise<string>((r) => { release = r; }) : Promise.resolve("fresh-source"));
    try {
      engine.play([A]); expect(engine.getState().phase).toBe("loading");
      engine.pause(); release("stale-source"); await flush();
      expect(audio.src).toBe(""); expect(audio.playCalls).toBe(0); expect(engine.getState().phase).toBe("paused");
      engine.resume(); await flush(); expect(audio.src).toBe("fresh-source"); expect(engine.getState().phase).toBe("playing");
    } finally { engine.dispose(); }
  });
  it("ignores an old play rejection after another track starts", async () => {
    const { engine, audio } = make(); let reject!: (reason: Error) => void;
    const play = audio.play.bind(audio); audio.play = () => new Promise<void>((_, r) => { reject = r; });
    try {
      engine.play([A, B]); await flush(); audio.play = play;
      engine.jump(1); await flush(); reject(new Error("old decoder failure")); await flush();
      expect(engine.current?.path).toBe(B.path); expect(engine.getState()).toMatchObject({ phase: "playing", error: null });
    } finally { engine.dispose(); }
  });
  it("isolates decoder events from the old native audio element", async () => {
    const { engine, audios } = seamless();
    try {
      engine.setTransitions(false, 0); engine.play([A, B]); await settleTransitions();
      const old = audios[0]; engine.jump(1); await settleTransitions();
      old.fire("error"); old.fire("waiting"); old.finish();
      expect(engine.current?.path).toBe(B.path); expect(engine.getState()).toMatchObject({ phase: "playing", error: null });
    } finally { engine.dispose(); }
  });
  it("times out stalled loading with recovery details", async () => {
    vi.useFakeTimers(); const { engine } = make({}, () => new Promise<string>(() => {}));
    try { engine.play([A]); vi.advanceTimersByTime(30000); expect(engine.getState()).toMatchObject({ phase: "failed", loading: false }); expect(engine.getState().errorDetails).toMatch(/30 seconds/); }
    finally { engine.dispose(); }
  });
  it("shows buffering and rejects invalid control values", async () => {
    const { engine, audio } = make();
    try {
      engine.play([A]); await flush(); audio.loaded(120); audio.fire("waiting"); expect(engine.getState().phase).toBe("buffering");
      engine.setVolume(NaN); engine.setRate(Infinity); engine.seek(NaN);
      expect(audio.volume).toBe(1); expect(audio.playbackRate).toBe(1); expect(audio.currentTime).toBe(0);
      engine.pause(); audio.fire("playing"); expect(audio.paused).toBe(true); expect(engine.getState().phase).toBe("paused");
    } finally { engine.dispose(); }
  });
  it("stops at the first failure by default and can retry after a drive returns", async () => {
    let missing = true;
    const { engine } = make({}, async (track) => { if (missing) throw new Error("Drive disconnected"); return track.path; });
    try {
      engine.play([A, B]); await flush(); expect(engine.current?.path).toBe(A.path); expect(engine.getState().phase).toBe("failed");
      missing = false; engine.retry(); await flush(); expect(engine.getState().phase).toBe("playing");
    } finally { engine.dispose(); }
  });
  it("automatically skips failures once per path and stops even with repeat enabled", async () => {
    const attempted: string[] = [];
    const { engine } = make({}, async (track) => { attempted.push(track.path); throw new Error("Missing file"); });
    try {
      engine.setPlaybackPolicy(true, "linear", true); engine.setRepeat("all"); engine.play([A, B, C]); await flush();
      expect(attempted).toEqual([A.path, B.path, C.path]); expect(engine.getState().phase).toBe("failed"); expect(engine.getState().notice).toMatch(/no playable tracks/);
    } finally { engine.dispose(); }
  });
  it("does not skip sleep-after-track", async () => {
    const attempted: string[] = [];
    const { engine } = make({}, async (track) => { attempted.push(track.path); throw new Error("Missing"); });
    try { engine.setPlaybackPolicy(true, "linear", true); engine.setSleep("track"); engine.play([A, B]); await flush(); expect(attempted).toEqual([A.path]); }
    finally { engine.dispose(); }
  });
  it("does not automatically skip a permission refusal", async () => {
    const { engine, audio, resolved } = make();
    audio.play = async () => { throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }); };
    try {
      engine.setPlaybackPolicy(true, "linear", true); engine.play([A, B]); await flush();
      expect(resolved).toEqual([A.path]); expect(engine.getState()).toMatchObject({ phase: "failed", error: "Press play to start the music." });
    } finally { engine.dispose(); }
  });
});

describe("safer crossfades and audio outputs", () => {
  it("offers equal-power gains while preserving separate volume and loudness", async () => {
    vi.useFakeTimers(); const { engine, audios, ready, advance } = seamless(2);
    try {
      engine.setPlaybackPolicy(false, "equalPower", true); engine.setVolume(0.5);
      engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
      audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
      audios[0].currentTime = 9; audios[1].currentTime = 1; advance(1000); vi.advanceTimersByTime(40);
      expect(audios[0].volume).toBeCloseTo(Math.SQRT1_2 / 2); expect(audios[1].volume).toBeCloseTo(Math.SQRT1_2 / 2);
    } finally { engine.dispose(); }
  });
  it("keeps consecutive tracks on the same album preloaded without overlapping", async () => {
    const { engine, audios, ready } = seamless(3);
    try {
      engine.play([{ ...A, album: "Live", albumArtist: "Band", trackNumber: 1 }, { ...B, album: "Live", albumArtist: "Band", trackNumber: 2 }]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
      audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions(); expect(audios[1].playCalls).toBe(0);
      audios[0].finish(); await settleTransitions(); expect(engine.current?.path).toBe(B.path); expect(engine.getState().phase).toBe("playing");
    } finally { engine.dispose(); }
  });
  it("restores the outgoing song if the incoming decoder fails during overlap", async () => {
    const { engine, audios, ready, played } = seamless(3);
    try {
      engine.play([A, B]); await settleTransitions(); ready(audios[0]); ready(audios[1]);
      audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
      engine.updateTrackDetails([{ ...A, format: "MP3" }, B]); audios[1].fire("error");
      expect(engine.current?.path).toBe(A.path); expect(engine.getState()).toMatchObject({ phase: "playing", error: null });
      expect(audios[0].paused).toBe(false); expect(audios[0].volume).toBe(1); expect(audios[1].src).toBe(""); expect(played).not.toHaveBeenCalled();
      audios[0].fire("timeupdate"); await settleTransitions(); expect(engine.current?.path).toBe(A.path);
    } finally { engine.dispose(); }
  });
  it("routes preloaded decks and active overlaps to the selected output", async () => {
    const { engine, audios, ready } = seamless(3);
    const sinks = new Map<FakeAudio, string>();
    const route = (audio: FakeAudio) => Object.assign(audio, { setSinkId: async (id: string) => { sinks.set(audio, id); } });
    try {
      route(audios[0]); await engine.setOutputDevice("headphones");
      engine.play([A, B]); await settleTransitions(); route(audios[1]); ready(audios[0]); ready(audios[1]);
      await engine.setOutputDevice("headphones"); expect(sinks.get(audios[1])).toBe("headphones");
      audios[0].currentTime = 8; audios[0].fire("timeupdate"); await settleTransitions();
      await engine.setOutputDevice("speakers"); expect(sinks.get(audios[0])).toBe("speakers"); expect(sinks.get(audios[1])).toBe("speakers");
    } finally { engine.dispose(); }
  });
  it("falls back all decks when one device switch fails", async () => {
    const { engine, audio } = make(); let sink = "";
    Object.assign(audio, { setSinkId: async (id: string) => { if (id === "gone") throw new Error("Disconnected"); sink = id; } });
    try {
      await engine.setOutputDevice("speaker"); await expect(engine.setOutputDevice("gone")).rejects.toThrow("Disconnected");
      expect(sink).toBe(""); expect(engine.getState().notice).toMatch(/system default/);
    } finally { engine.dispose(); }
  });
  it("serializes rapid device switches so the latest choice wins", async () => {
    const { engine, audio } = make(); let sink = ""; let release!: () => void;
    Object.assign(audio, { setSinkId: async (id: string) => { if (id === "slow") await new Promise<void>((r) => { release = r; }); sink = id; } });
    try {
      const first = engine.setOutputDevice("slow"); await settleTransitions();
      const last = engine.setOutputDevice("latest"); release(); await Promise.all([first, last]); expect(sink).toBe("latest");
    } finally { engine.dispose(); }
  });
});

describe("sleep fade-out", () => {
  it("does not autoplay a source that resolves after the sleep deadline", async () => {
    vi.useFakeTimers(); let resolve!: (src: string) => void;
    const { engine, audio, advance } = make({}, () => new Promise<string>((r) => { resolve = r; }));
    try {
      engine.play([A]); engine.setSleep({ minutes: 1, fadeSeconds: 10 });
      advance(60000); vi.advanceTimersByTime(60000); resolve("late-source"); await settleTransitions();
      expect(audio.playCalls).toBe(0); expect(audio.src).toBe("");
      expect(engine.getState()).toMatchObject({ playing: false, loading: false, sleep: null });
    } finally { engine.dispose(); }
  });
  it("fades the output without changing saved volume and restores it after stopping", async () => {
    vi.useFakeTimers();
    const { engine, audio, advance } = make();
    try {
      engine.play([A]); await settleTransitions(); audio.loaded(120); engine.setVolume(0.6);
      engine.setSleep({ minutes: 1, fadeSeconds: 20 });
      advance(40000); vi.advanceTimersByTime(40000); expect(audio.volume).toBeCloseTo(0.6);
      advance(10000); vi.advanceTimersByTime(10000); expect(audio.volume).toBeCloseTo(0.3);
      expect(engine.getState().volume).toBe(0.6);
      advance(10000); vi.advanceTimersByTime(10000);
      expect(engine.getState()).toMatchObject({ sleep: null, playing: false, volume: 0.6 });
      expect(audio.paused).toBe(true); expect(audio.volume).toBeCloseTo(0.6);
      engine.resume(); await settleTransitions(); expect(audio.volume).toBeCloseTo(0.6);
    } finally { engine.dispose(); }
  });
  it("finishes and fades the current song after the deadline without advancing the queue", async () => {
    vi.useFakeTimers(); const { engine, audio, advance } = make();
    try {
      engine.play([A, B]); await settleTransitions(); audio.loaded(120);
      engine.setSleep({ minutes: 1, fadeSeconds: 20, finishTrack: true });
      audio.currentTime = 60; advance(60000); vi.advanceTimersByTime(60000);
      expect(engine.getState().sleep).toMatchObject({ kind: "track", fadeSeconds: 20 });
      expect(engine.getState().playing).toBe(true); expect(audio.volume).toBe(1);
      audio.currentTime = 110; advance(100); vi.advanceTimersByTime(100); expect(audio.volume).toBeCloseTo(0.5);
      audio.finish(); await settleTransitions();
      expect(engine.current?.path).toBe(A.path); expect(engine.getState()).toMatchObject({ playing: false, sleep: null });
    } finally { engine.dispose(); }
  });
  it("cancels a fade and cleans up timers when the queue is cleared", async () => {
    vi.useFakeTimers(); const { engine, audio, advance } = make();
    try {
      engine.play([A]); await settleTransitions(); audio.loaded(120); engine.setSleep("track", 20);
      audio.currentTime = 110; advance(100); vi.advanceTimersByTime(100); expect(audio.volume).toBeCloseTo(0.5);
      engine.setSleep(null); expect(audio.volume).toBe(1);
      engine.setSleep({ minutes: 1, fadeSeconds: 20 }); engine.clear();
      expect(engine.getState().sleep).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    } finally { engine.dispose(); }
  });
});
