import { insertAfter, moveItem, removeAt, shuffleAround, unshuffle } from "./playQueue";
import { forget, remember, resumeAt, type Positions } from "./positions";

// The music player's brain: a queue, the audio element, and everything that happens around them (resuming a long file where
// it stopped, speed, a sleep timer, repeat and shuffle). It knows nothing about the page, so it can be tested with a fake
// audio element.

export interface Track {
  /** The file on disk. */
  path: string;
  title: string;
  artist?: string;
  album?: string;
  /** A picture to show (an address the page can load), when there is one. */
  cover?: string | null;
  /** Seconds, when known before playing. */
  duration?: number;
}

export type RepeatMode = "off" | "all" | "one";
/** Stop playing at a time, or when the current track ends. */
export type Sleep = { kind: "timer"; endsAt: number } | { kind: "track" } | null;

export interface PlayerState {
  queue: Track[];
  /** The current track's place in the queue, or -1 for none. */
  index: number;
  playing: boolean;
  /** Getting the file ready or waiting for data. */
  loading: boolean;
  /** Seconds. */
  duration: number;
  /** 0 to 1. */
  volume: number;
  rate: number;
  repeat: RepeatMode;
  shuffle: boolean;
  sleep: Sleep;
  error: string | null;
}

export interface PlayerTime {
  position: number;
  duration: number;
}

/** The parts of an `HTMLAudioElement` the engine uses. */
export interface AudioLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  volume: number;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface EngineDeps {
  audio: AudioLike;
  /** Makes a file playable and says where from (the page may only play files it has been told about). */
  resolve: (track: Track) => Promise<string>;
  getPositions: () => Positions;
  setPositions: (positions: Positions) => void;
  now?: () => number;
  random?: () => number;
}

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SAVE_EVERY_MS = 5000;
const RESTART_AFTER_SECONDS = 3;
const SKIP_SECONDS = 10;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "This file can't be played.");

export const CANT_PLAY = "This file can't be played here. It may be damaged, or in a format Kaisu's player doesn't support.";

/** What to tell the user when the browser refuses to play, or `null` when it only means "a newer request replaced this one". */
export function playbackError(e: unknown): string | null {
  const name = (e as { name?: string } | null)?.name;
  if (name === "AbortError") return null;
  if (name === "NotSupportedError") return CANT_PLAY;
  if (name === "NotAllowedError") return "Press play to start the music.";
  return errorText(e);
}

export class PlayerEngine {
  private readonly audio: AudioLike;
  private readonly deps: EngineDeps;
  private state: PlayerState = { queue: [], index: -1, playing: false, loading: false, duration: 0, volume: 1, rate: 1, repeat: "off", shuffle: false, sleep: null, error: null };
  private time: PlayerTime = { position: 0, duration: 0 };
  private listeners = new Set<() => void>();
  private timeListeners = new Set<() => void>();
  private loadToken = 0;
  private original: Track[] | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSaved = 0;
  private pendingSeek = 0;
  /** A restored queue whose current file hasn't been opened yet. */
  private unloaded = false;
  /** The audio element has been given a file (its own `src` can't say, since an empty one reads back as the page's address). */
  private hasSource = false;
  /** Quieter playback for loud tracks (1 = unchanged). */
  private levelFactor = 1;
  private readonly handlers: Array<[string, () => void]>;

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.audio = deps.audio;
    this.handlers = [
      ["loadedmetadata", () => this.onMetadata()],
      ["durationchange", () => this.onMetadata()],
      ["playing", () => this.set({ playing: true, loading: false, error: null })],
      ["pause", () => this.onPause()],
      ["waiting", () => this.set({ loading: true })],
      ["canplay", () => this.set({ loading: false })],
      ["timeupdate", () => this.onTime()],
      ["ended", () => this.onEnded()],
      ["error", () => this.onError()],
    ];
    for (const [type, fn] of this.handlers) this.audio.addEventListener(type, fn);
  }

  dispose() {
    for (const [type, fn] of this.handlers) this.audio.removeEventListener(type, fn);
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.loadToken++;
    this.listeners.clear();
    this.timeListeners.clear();
  }

  // ---- reading --------------------------------------------------------------------------------

  getState = (): PlayerState => this.state;
  getTime = (): PlayerTime => this.time;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  /** Position changes several times a second, so they have their own channel. */
  subscribeTime = (fn: () => void) => {
    this.timeListeners.add(fn);
    return () => this.timeListeners.delete(fn);
  };

  get current(): Track | null {
    return this.state.queue[this.state.index] ?? null;
  }

  private now = () => (this.deps.now ?? Date.now)();

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private setTime(position: number, duration: number) {
    if (position === this.time.position && duration === this.time.duration) return;
    this.time = { position, duration };
    this.timeListeners.forEach((fn) => fn());
  }

  // ---- playing --------------------------------------------------------------------------------

  /** Plays `tracks`, starting from `start`, instead of whatever was queued. */
  play(tracks: Track[], start = 0) {
    if (tracks.length === 0) return;
    this.saveNow();
    this.original = null;
    let queue = tracks;
    let index = clamp(start, 0, tracks.length - 1);
    if (this.state.shuffle) {
      this.original = tracks;
      ({ queue, current: index } = shuffleAround(tracks, index, this.deps.random));
    }
    this.set({ queue, index });
    void this.load(index, true, { save: false });
  }

  /** Sets a queue up without playing it (after a restart). It opens the file when play is pressed. */
  restore(tracks: Track[], index: number, position: number) {
    if (tracks.length === 0) return;
    const i = clamp(index, 0, tracks.length - 1);
    this.set({ queue: tracks, index: i, duration: tracks[i].duration ?? 0 });
    this.pendingSeek = Math.max(0, position);
    this.unloaded = true;
    this.setTime(this.pendingSeek, tracks[i].duration ?? 0);
  }

  /**
   * Opens the track at `index`. By default it first saves where the previous one was, and starts from where this one was
   * left last time; `usePending` starts from the position a restored queue was waiting at instead.
   */
  private async load(index: number, autoplay: boolean, { usePending = false, save = true } = {}) {
    const track = this.state.queue[index];
    if (!track) return;
    const token = ++this.loadToken;
    if (save) this.saveNow();
    if (!usePending) this.pendingSeek = 0;
    this.unloaded = false;
    this.set({ index, loading: true, error: null, playing: false, duration: track.duration ?? 0 });
    this.setTime(0, track.duration ?? 0);
    let src: string;
    try {
      src = await this.deps.resolve(track);
    } catch (e) {
      if (token === this.loadToken) this.set({ loading: false, error: errorText(e) });
      return;
    }
    if (token !== this.loadToken) return;
    if (this.pendingSeek === 0) this.pendingSeek = resumeAt(this.deps.getPositions(), track.path);
    this.audio.src = src;
    this.hasSource = true;
    this.audio.playbackRate = this.state.rate;
    this.applyVolume();
    if (!autoplay) {
      this.set({ loading: false });
      return;
    }
    try {
      await this.audio.play();
    } catch (e) {
      const why = playbackError(e);
      if (token === this.loadToken && why) this.set({ loading: false, playing: false, error: why });
    }
  }

  toggle() {
    if (this.state.index < 0) return;
    if (this.unloaded) {
      void this.load(this.state.index, true, { usePending: true });
    } else if (this.state.error) {
      void this.load(this.state.index, true);
    } else if (this.state.playing) {
      this.audio.pause();
    } else {
      void this.audio.play().catch((e) => {
        const why = playbackError(e);
        if (why) this.set({ error: why });
      });
    }
  }

  pause() {
    if (this.state.playing) this.audio.pause();
  }

  resume() {
    if (!this.state.playing) this.toggle();
  }

  next() {
    const { index, queue, repeat } = this.state;
    if (index + 1 < queue.length) void this.load(index + 1, true);
    else if (repeat === "all" && queue.length > 0) void this.load(0, true);
  }

  previous() {
    const { index, queue, repeat } = this.state;
    if (this.audio.currentTime > RESTART_AFTER_SECONDS || queue.length === 0) this.seek(0);
    else if (index > 0) void this.load(index - 1, true);
    else if (repeat === "all") void this.load(queue.length - 1, true);
    else this.seek(0);
  }

  /** Plays the item at `index` of the queue now. */
  jump(index: number) {
    if (index >= 0 && index < this.state.queue.length) void this.load(index, true);
  }

  seek(seconds: number) {
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    const t = clamp(seconds, 0, d > 0 ? d : seconds);
    if (this.unloaded) this.pendingSeek = t;
    else this.audio.currentTime = t;
    this.setTime(t, this.time.duration);
  }

  skip(delta: number = SKIP_SECONDS) {
    this.seek((this.unloaded ? this.pendingSeek : this.audio.currentTime) + delta);
  }

  // ---- settings of the player -----------------------------------------------------------------

  setRate(rate: number) {
    const r = Math.round(clamp(rate, 0.5, 2) * 100) / 100;
    this.audio.playbackRate = r;
    this.set({ rate: r });
  }

  setVolume(volume: number) {
    this.set({ volume: clamp(volume, 0, 1) });
    this.applyVolume();
  }

  /** Makes loud tracks quieter by `db` decibels (never louder). 0 turns it off. */
  setLevelGain(db: number) {
    this.levelFactor = Math.pow(10, Math.min(0, Number.isFinite(db) ? db : 0) / 20);
    this.applyVolume();
  }

  private applyVolume() {
    this.audio.volume = clamp(this.state.volume * this.levelFactor, 0, 1);
  }

  setRepeat(repeat: RepeatMode) {
    this.set({ repeat });
  }

  toggleShuffle() {
    const { queue, index, shuffle } = this.state;
    if (!shuffle) {
      this.original = queue;
      const s = shuffleAround(queue, index, this.deps.random);
      this.set({ shuffle: true, queue: s.queue, index: s.current });
    } else {
      const back = this.original ? unshuffle(queue, index, this.original) : { queue, current: index };
      this.original = null;
      this.set({ shuffle: false, queue: back.queue, index: back.current });
    }
  }

  /** Gives a queued track its picture once it has been loaded. The track keeps its place. */
  setCover(track: Track, cover: string) {
    if (track.cover === cover) return;
    const next: Track = { ...track, cover };
    const swap = (list: Track[]) => list.map((t) => (t === track ? next : t));
    if (this.original) this.original = swap(this.original);
    this.set({ queue: swap(this.state.queue) });
  }

  /** Puts back volume, speed, repeat and shuffle after a restart (the saved queue is already in its shuffled order). */
  applySettings(s: { volume: number; rate: number; repeat: RepeatMode; shuffle: boolean }) {
    this.audio.playbackRate = clamp(s.rate, 0.5, 2);
    this.set({ volume: clamp(s.volume, 0, 1), rate: clamp(s.rate, 0.5, 2), repeat: s.repeat, shuffle: s.shuffle });
    this.applyVolume();
  }

  /** `{ minutes }` stops after that long, `"track"` when the current track ends, `null` cancels. */
  setSleep(spec: { minutes: number } | "track" | null) {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (spec === null) return this.set({ sleep: null });
    if (spec === "track") return this.set({ sleep: { kind: "track" } });
    const ms = Math.max(1, spec.minutes) * 60_000;
    this.set({ sleep: { kind: "timer", endsAt: this.now() + ms } });
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      this.set({ sleep: null });
      this.pause();
    }, ms);
  }

  // ---- the queue ------------------------------------------------------------------------------

  /** Adds to the end of the queue. */
  enqueue(tracks: Track[]) {
    if (tracks.length === 0) return;
    if (this.state.queue.length === 0) return this.restoreFresh(tracks);
    if (this.original) this.original = [...this.original, ...tracks];
    this.set({ queue: [...this.state.queue, ...tracks] });
  }

  /** Adds right after the current track. */
  playNext(tracks: Track[]) {
    if (tracks.length === 0) return;
    if (this.state.queue.length === 0) return this.restoreFresh(tracks);
    if (this.original) {
      const at = this.original.indexOf(this.current as Track);
      this.original = insertAfter(this.original, at, tracks);
    }
    this.set({ queue: insertAfter(this.state.queue, this.state.index, tracks) });
  }

  /** Nothing was queued: the first item becomes the current one, waiting to be played. */
  private restoreFresh(tracks: Track[]) {
    this.restore(tracks, 0, 0);
  }

  remove(at: number) {
    const { queue, index, playing } = this.state;
    const r = removeAt(queue, index, at);
    if (r.queue === queue) return;
    this.saveNow();
    if (this.original) this.original = this.original.filter((t) => t !== queue[at]);
    if (r.queue.length === 0) return this.clear();
    this.set({ queue: r.queue, index: r.current });
    if (r.removedCurrent) {
      if (playing) void this.load(r.current, true, { save: false });
      else {
        this.audio.pause();
        this.unloaded = true;
        this.pendingSeek = 0;
        this.setTime(0, r.queue[r.current].duration ?? 0);
      }
    }
  }

  move(from: number, to: number) {
    const m = moveItem(this.state.queue, this.state.index, from, to);
    if (m.queue !== this.state.queue) this.set({ queue: m.queue, index: m.current });
  }

  clear() {
    this.loadToken++;
    this.saveNow();
    this.hasSource = false;
    this.audio.pause();
    this.audio.src = "";
    this.original = null;
    this.unloaded = false;
    this.pendingSeek = 0;
    this.set({ queue: [], index: -1, playing: false, loading: false, duration: 0, error: null });
    this.setTime(0, 0);
  }

  // ---- what the audio element reports ---------------------------------------------------------

  private onMetadata() {
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) {
      if (d !== this.state.duration) this.set({ duration: d });
      if (this.pendingSeek > 0 && this.pendingSeek < d) {
        this.audio.currentTime = this.pendingSeek;
        this.setTime(this.pendingSeek, d);
      }
      this.pendingSeek = 0;
    }
  }

  private onTime() {
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    this.setTime(this.audio.currentTime, d);
    if (this.now() - this.lastSaved >= SAVE_EVERY_MS) this.saveNow();
  }

  private onPause() {
    this.set({ playing: false });
    this.saveNow();
  }

  private onError() {
    if (!this.hasSource) return;
    this.set({ playing: false, loading: false, error: CANT_PLAY });
  }

  private onEnded() {
    const track = this.current;
    if (track) this.deps.setPositions(forget(this.deps.getPositions(), track.path));
    const { sleep, repeat } = this.state;
    if (sleep?.kind === "track") {
      this.set({ sleep: null, playing: false });
      this.setTime(0, this.time.duration);
      return;
    }
    if (repeat === "one") {
      this.audio.currentTime = 0;
      void this.audio.play().catch(() => {});
      return;
    }
    const { index, queue } = this.state;
    if (index + 1 < queue.length) void this.load(index + 1, true);
    else if (repeat === "all") void this.load(0, true);
    else {
      this.set({ playing: false });
      this.setTime(0, this.time.duration);
    }
  }

  /** Writes down where playback is, for files long enough to be worth resuming. */
  private saveNow() {
    this.lastSaved = this.now();
    const track = this.current;
    if (!track || this.unloaded) return;
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    this.deps.setPositions(remember(this.deps.getPositions(), track.path, this.audio.currentTime, d, this.now()));
  }
}
