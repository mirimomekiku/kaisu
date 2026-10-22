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
  coverRevision?: number;
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
  readonly readyState?: number;
  preload?: string;
  load?: () => void;
  volume: number;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface EngineDeps {
  audio: AudioLike;
  createAudio?: () => AudioLike;
  /** Makes a file playable and says where from (the page may only play files it has been told about). */
  resolve: (track: Track) => Promise<string>;
  getPositions: () => Positions;
  setPositions: (positions: Positions) => void;
  now?: () => number;
  random?: () => number;
  onPlayed?: (track: Track) => void;
  onListen?: (track: Track, seconds: number) => void;
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
  private audio: AudioLike;
  private readonly deps: EngineDeps;
  private state: PlayerState = { queue: [], index: -1, playing: false, loading: false, duration: 0, volume: 1, rate: 1, repeat: "off", shuffle: false, sleep: null, error: null };
  private time: PlayerTime = { position: 0, duration: 0 };
  private listeners = new Set<() => void>();
  private timeListeners = new Set<() => void>();
  private loadToken = 0;
  private original: Track[] | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSaved = 0;
  private listenLast: { track: Track; at: number; position: number; rate: number; gain: number } | null = null;
  private listenPending = 0;
  private listenTrack: Track | null = null;
  private pendingSeek = 0;
  /** A restored queue whose current file hasn't been opened yet. */
  private unloaded = false;
  /** The audio element has been given a file (its own `src` can't say, since an empty one reads back as the page's address). */
  private hasSource = false;
  /** Quieter playback for loud tracks (1 = unchanged). */
  private levelFactor = 1;
  private readonly handlers: Array<[string, () => void]>;
  private bound = new Map<AudioLike, Array<[string, () => void]>>();
  private gapless = false;
  private disposed = false;
  private transitionTimer: ReturnType<typeof setInterval> | null = null;
  private editingFiles = new Set<string>();
  private crossfadeSeconds = 0;
  private preloadToken = 0;
  private preloadScheduled = false;
  private prepared: { audio: AudioLike; index: number; path: string; ready: boolean; token: number; start: number } | null = null;
  private promoting: { prepared: NonNullable<PlayerEngine["prepared"]>; oldEnded: boolean } | null = null;
  private tail: { audio: AudioLike; track: Track; level: number; start: number; end: number; gain: number; lastAt: number; lastPosition: number; lastGain: number; pending: number } | null = null;
  private activeGain = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private levelMap = new Map<string, number>();

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.audio = deps.audio;
    this.handlers = [
      ["loadedmetadata", () => this.onMetadata()],
      ["durationchange", () => this.onMetadata()],
      ["playing", () => { this.set({ playing: true, loading: false, error: null }); this.listenLast = this.listeningPoint(); if (this.tail?.audio.paused) { this.tail.lastAt = this.now(); this.tail.lastPosition = this.tail.audio.currentTime; void this.tail.audio.play().catch(() => this.finishTail(false)); } }],
      ["pause", () => this.onPause()],
      ["waiting", () => { this.sampleListening(true); this.listenLast = null; this.sampleTail(true); this.tail?.audio.pause(); this.set({ loading: true }); }],
      ["canplay", () => this.set({ loading: false })],
      ["timeupdate", () => this.onTime()],
      ["ended", () => this.onEnded()],
      ["error", () => this.onError()],
    ];
    this.bindAudio(this.audio);
  }

  dispose() {
    this.disposed = true;
    if (this.transitionTimer) clearInterval(this.transitionTimer); this.transitionTimer = null;
    this.sampleListening(true);
    this.cancelPreload(); this.finishTail(false);
    for (const audio of [...this.bound.keys()]) { this.unbindAudio(audio); audio.pause(); audio.src = ""; }
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
    if (patch.queue && (patch.queue.length !== this.state.queue.length || patch.queue.some((t, i) => t.path !== this.state.queue[i]?.path))) { this.cancelPreload(); this.finishTail(false); }
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
    this.schedulePreload(); this.refreshTransitionTimer();
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
    if (this.editingFiles.has(track.path)) { this.set({ error: "Wait for this file to finish saving before playing it.", loading: false, playing: false }); return; }
    const token = ++this.loadToken;
    if (save) this.saveNow();
    this.cancelPreload(); this.finishTail(false);
    this.listenLast = null;
    if (!usePending) this.pendingSeek = 0;
    this.unloaded = false;
    this.set({ index, loading: true, error: null, playing: false, duration: track.duration ?? 0 });
    this.setTime(0, track.duration ?? 0);
    this.audio.pause();
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
      this.pause();
    } else {
      void this.audio.play().catch((e) => {
        const why = playbackError(e);
        if (why) this.set({ error: why });
      });
    }
  }

  pause() {
    if (this.promoting) this.cancelPreload(false);
    this.sampleTail(true); this.tail?.audio.pause();
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
    if (this.promoting) this.cancelPreload(false);
    this.finishTail(false);
    this.sampleListening(true);
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    const t = clamp(seconds, 0, d > 0 ? d : seconds);
    if (this.unloaded) this.pendingSeek = t;
    else this.audio.currentTime = t;
    this.listenLast = this.listeningPoint();
    this.setTime(t, this.time.duration);
  }

  skip(delta: number = SKIP_SECONDS) {
    this.seek((this.unloaded ? this.pendingSeek : this.audio.currentTime) + delta);
  }

  // ---- settings of the player -----------------------------------------------------------------

  setRate(rate: number) {
    this.finishTail(false); this.cancelPreload();
    this.sampleListening(true);
    const r = Math.round(clamp(rate, 0.5, 2) * 100) / 100;
    this.audio.playbackRate = r;
    this.set({ rate: r });
    this.listenLast = this.listeningPoint();
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
    this.audio.volume = clamp(this.state.volume * this.levelFactor * this.activeGain, 0, 1);
    if (this.tail) this.tail.audio.volume = clamp(this.state.volume * this.tail.level * this.tail.gain, 0, 1);
  }

  setRepeat(repeat: RepeatMode) {
    this.cancelPreload();
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
    if (spec === "track") { this.cancelPreload(false); return this.set({ sleep: { kind: "track" } }); }
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
    this.cancelPreload(); this.finishTail(false);
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
    this.sampleListening();
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    this.setTime(this.audio.currentTime, d);
    if (this.now() - this.lastSaved >= SAVE_EVERY_MS) this.saveNow();
    this.maybeCrossfade();
  }

  private onPause() {
    if (this.state.loading && !this.state.playing) return;
    this.sampleTail(true); this.tail?.audio.pause();
    this.sampleListening(true);
    this.listenLast = null;
    this.set({ playing: false });
    this.saveNow();
  }

  private onError() {
    if (!this.hasSource) return;
    this.sampleListening(true);
    this.listenLast = null;
    this.cancelPreload(); this.finishTail(false);
    this.set({ playing: false, loading: false, error: CANT_PLAY });
  }

  private onEnded() {
    this.sampleListening(true);
    this.listenLast = null;
    const track = this.current;
    if (track) this.deps.onPlayed?.(track);
    if (track) this.deps.setPositions(forget(this.deps.getPositions(), track.path));
    if (this.promoting) { this.promoting.oldEnded = true; return; }
    this.advanceAfterEnd();
  }

  private advanceAfterEnd() {
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
    if (this.readyPrepared()) { void this.promote(false, true); return; }
    const { index, queue } = this.state;
    if (index + 1 < queue.length) void this.load(index + 1, true);
    else if (repeat === "all") void this.load(0, true);
    else {
      this.set({ playing: false });
      this.setTime(0, this.time.duration);
    }
  }

  private listeningPoint() {
    const track = this.current;
    return track && this.state.playing && !this.state.loading ? { track, at: this.now(), position: this.audio.currentTime, rate: this.state.rate, gain: this.activeGain } : null;
  }

  /** Measure actual playback, excluding pauses, buffering, seeks and long suspended-clock gaps. */
  private sampleListening(flush = false) {
    const previous = this.listenLast;
    const next = this.listeningPoint();
    if (previous && next && previous.track.path === next.track.path) {
      const elapsed = (next.at - previous.at) / 1000;
      const advanced = next.position - previous.position;
      if (elapsed > 0 && elapsed <= 30 && advanced > 0 && advanced <= elapsed * previous.rate + 1) {
        this.listenTrack = previous.track;
        this.listenPending += Math.min(elapsed, advanced / previous.rate) * ((previous.gain + next.gain) / 2);
      }
    }
    this.listenLast = next;
    if ((flush || this.listenPending >= 5) && this.listenPending > 0 && this.listenTrack) {
      this.deps.onListen?.(this.listenTrack, this.listenPending);
      this.listenPending = 0;
    }
  }

  /** Writes down where playback is, for files long enough to be worth resuming. */
  private saveNow() {
    this.sampleListening(true);
    this.lastSaved = this.now();
    const track = this.current;
    if (!track || this.unloaded) return;
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    this.deps.setPositions(remember(this.deps.getPositions(), track.path, this.audio.currentTime, d, this.now()));
  }

  /** Keep queued tracks usable after the user locates a moved file. */
  replacePath(from: string, to: string) {
    this.saveNow(); this.cancelPreload(); this.finishTail(false); this.listenLast = null;
    const positions = this.deps.getPositions();
    if (from !== to && positions[from]) {
      const next = { ...positions, [to]: positions[from] };
      delete next[from];
      this.deps.setPositions(next);
    }
    const swap = (queue: Track[]) => queue.map((t) => t.path === from ? { ...t, path: to, cover: undefined } : t);
    if (this.original) this.original = swap(this.original);
    this.set({ queue: swap(this.state.queue) });
  }
  setTransitions(gapless: boolean, seconds: number) {
    const fade = gapless && Number.isFinite(seconds) ? clamp(seconds, 0, 12) : 0;
    if (this.gapless === gapless && this.crossfadeSeconds === fade) return;
    this.gapless = gapless; this.crossfadeSeconds = fade;
    this.cancelPreload(); this.finishTail(false); this.schedulePreload(); this.refreshTransitionTimer();
  }

  setLevelMap(levels: Map<string, number>) { this.levelMap = levels; }

  /** Release open handles before rewriting tags/artwork; resume remains available at the same position. */
  releaseFiles(paths: string[]) {
    const wanted = new Set(paths);
    for (const path of wanted) this.editingFiles.add(path);
    if (this.prepared && wanted.has(this.prepared.path)) this.cancelPreload();
    if (this.tail && wanted.has(this.tail.track.path)) this.finishTail(false);
    if (this.current && wanted.has(this.current.path) && !this.unloaded) {
      if (!this.state.loading) this.saveNow();
      this.pendingSeek = this.state.loading ? resumeAt(this.deps.getPositions(), this.current.path) : this.audio.currentTime;
      this.loadToken++; this.audio.pause();
      this.audio.src = ""; this.hasSource = false; this.unloaded = true;
      this.set({ playing: false, loading: false });
    }
    return () => { for (const path of wanted) this.editingFiles.delete(path); this.schedulePreload(); };
  }

  invalidateCovers(paths: string[]) {
    const wanted = new Set(paths);
    const swap = (list: Track[]) => list.map((t) => wanted.has(t.path) ? { ...t, cover: undefined, coverRevision: (t.coverRevision ?? 0) + 1 } : t);
    if (this.original) this.original = swap(this.original);
    this.set({ queue: swap(this.state.queue) });
  }

  private bindAudio(audio: AudioLike) {
    if (this.bound.has(audio)) return;
    const handlers = this.handlers.map(([type, fn]): [string, () => void] => [type, () => {
      if (audio === this.audio) fn();
      else if (this.tail?.audio === audio) {
        if (type === "ended") this.finishTail(true);
        else if (type === "error" || type === "waiting") this.finishTail(false);
        else if (type === "timeupdate") this.sampleTail();
      } else if (this.prepared?.audio === audio) {
        if (type === "canplay") this.prepared.ready = true;
        else if (type === "error") this.prepared.ready = false;
      }
    }]);
    this.bound.set(audio, handlers); for (const [type, fn] of handlers) audio.addEventListener(type, fn);
  }

  private unbindAudio(audio: AudioLike) { const handlers = this.bound.get(audio) ?? []; for (const [type, fn] of handlers) audio.removeEventListener(type, fn); this.bound.delete(audio); }
  private dropAudio(audio: AudioLike) { this.unbindAudio(audio); audio.pause(); audio.src = ""; }

  private nextIndex() {
    if (this.state.sleep?.kind === "track" || this.state.repeat === "one") return -1;
    return this.state.index + 1 < this.state.queue.length ? this.state.index + 1 : this.state.repeat === "all" && this.state.queue.length > 1 ? 0 : -1;
  }

  private schedulePreload() {
    if (this.disposed) return;
    if (this.preloadScheduled) return;
    this.preloadScheduled = true;
    queueMicrotask(() => { this.preloadScheduled = false; void this.prepareNext(); });
  }

  private cancelPreload(advanceEnded = true) {
    const ended = advanceEnded && this.promoting?.oldEnded;
    const path = this.current?.path; const token = this.loadToken;
    this.preloadToken++;
    const prepared = this.prepared; this.prepared = null; this.promoting = null;
    if (prepared && prepared.audio !== this.audio) this.dropAudio(prepared.audio);
    if (ended) queueMicrotask(() => { if (!this.disposed && this.loadToken === token && this.hasSource && !this.unloaded && this.current?.path === path && !this.state.playing && !this.state.loading) this.advanceAfterEnd(); });
  }

  private async prepareNext() {
    if (this.disposed || !this.gapless || !this.deps.createAudio || !this.hasSource || this.unloaded || this.tail || this.promoting || !this.state.playing || this.state.loading) return;
    const index = this.nextIndex(); const track = this.state.queue[index];
    if (!track || this.editingFiles.has(track.path)) { this.cancelPreload(); return; }
    if (this.prepared?.index === index && this.prepared.path === track.path) return;
    this.cancelPreload(); const token = this.preloadToken;
    const audio = this.deps.createAudio(); audio.preload = "auto"; audio.volume = 0; audio.playbackRate = this.state.rate;
    const start = resumeAt(this.deps.getPositions(), track.path);
    const prepared = { audio, index, path: track.path, token, ready: false, start }; this.prepared = prepared; this.bindAudio(audio);
    try {
      const src = await this.deps.resolve(track);
      if (this.prepared !== prepared || token !== this.preloadToken) { this.dropAudio(audio); return; }
      audio.src = src; audio.load?.();
      prepared.ready = (audio.readyState ?? 0) >= 2;
    } catch { if (this.prepared === prepared) prepared.ready = false; }
  }

  private readyPrepared() {
    const p = this.prepared;
    return !!p && p.token === this.preloadToken && p.index === this.nextIndex() && this.state.queue[p.index]?.path === p.path && (p.ready || (p.audio.readyState ?? 0) >= 2);
  }

  private refreshTransitionTimer() {
    const enabled = !this.disposed && this.gapless && this.crossfadeSeconds > 0 && !!this.deps.createAudio && this.hasSource && !this.unloaded && this.state.playing && !this.state.loading;
    if (enabled && !this.transitionTimer) this.transitionTimer = setInterval(() => this.maybeCrossfade(), 40);
    else if (!enabled && this.transitionTimer) { clearInterval(this.transitionTimer); this.transitionTimer = null; }
  }

  private maybeCrossfade() {
    if (!this.crossfadeSeconds || this.tail || this.promoting || !this.state.playing || !this.readyPrepared()) return;
    const p = this.prepared!;
    if (p.start > 0 || !Number.isFinite(p.audio.duration) || p.audio.duration <= 0) return;
    const d = this.audio.duration;
    const fade = Math.min(this.crossfadeSeconds, d / (2 * this.state.rate), p.audio.duration / (2 * this.state.rate));
    const remaining = (d - this.audio.currentTime) / this.state.rate;
    if (remaining > 0 && remaining <= fade) void this.promote(true, false);
  }

  private async promote(crossfade: boolean, ended: boolean) {
    if (this.promoting || !this.readyPrepared()) return;
    const p = this.prepared!; const old = this.audio; const track = this.current!;
    const promotion = { prepared: p, oldEnded: ended }; this.promoting = promotion;
    try {
      p.audio.currentTime = p.start > 0 && p.start < p.audio.duration ? p.start : 0;
      p.audio.volume = 0;
      await p.audio.play();
      if (this.promoting !== promotion || !this.readyPrepared()) { if (this.promoting === promotion) this.cancelPreload(); if (p.audio !== this.audio) this.dropAudio(p.audio); return; }
      this.sampleListening(true); this.listenLast = null;
      const oldLevel = this.levelFactor;
      this.prepared = null; this.promoting = null; this.audio = p.audio; this.loadToken++;
      this.unloaded = false; this.pendingSeek = 0; this.hasSource = true;
      const overlap = crossfade && !promotion.oldEnded && !old.paused;
      if (overlap) {
        this.tail = { audio: old, track, level: oldLevel, start: old.currentTime, end: old.duration, gain: 1, lastAt: this.now(), lastPosition: old.currentTime, lastGain: 1, pending: 0 };
        this.activeGain = 0;
        this.fadeTimer = setInterval(() => this.tickFade(), 40);
      } else { this.dropAudio(old); this.activeGain = 1; }
      this.levelFactor = Math.pow(10, Math.min(0, this.levelMap.get(p.path) ?? 0) / 20);
      this.set({ index: p.index, playing: true, loading: false, error: null, duration: p.audio.duration });
      this.setTime(p.audio.currentTime, p.audio.duration); this.listenLast = this.listeningPoint(); this.applyVolume();
    } catch {
      if (this.promoting === promotion) {
        this.promoting = null; p.ready = false; this.dropAudio(p.audio); this.prepared = null;
        if (promotion.oldEnded) void this.load(p.index, true);
      }
    }
  }

  private tickFade() {
    if (!this.tail || !this.state.playing || this.state.loading) return;
    const t = this.tail;
    const progress = clamp((t.audio.currentTime - t.start) / Math.max(0.01, t.end - t.start), 0, 1);
    this.activeGain = progress; t.gain = 1 - progress;
    this.sampleListening(); this.sampleTail(); this.applyVolume();
  }

  private sampleTail(flush = false) {
    const t = this.tail; if (!t) return;
    const now = this.now(); const elapsed = (now - t.lastAt) / 1000; const advanced = t.audio.currentTime - t.lastPosition;
    if (this.state.playing && !this.state.loading && elapsed > 0 && elapsed <= 30 && advanced > 0 && advanced <= elapsed * this.state.rate + 1) t.pending += Math.min(elapsed, advanced / this.state.rate) * ((t.lastGain + t.gain) / 2);
    t.lastAt = now; t.lastPosition = t.audio.currentTime; t.lastGain = t.gain;
    if ((flush || t.pending >= 5) && t.pending > 0) { this.deps.onListen?.(t.track, t.pending); t.pending = 0; }
  }

  private finishTail(ended: boolean) {
    const t = this.tail; if (!t) return;
    this.sampleListening(true); this.sampleTail(true);
    this.tail = null; this.activeGain = 1;
    if (this.fadeTimer) clearInterval(this.fadeTimer); this.fadeTimer = null;
    if (ended) { this.deps.onPlayed?.(t.track); this.deps.setPositions(forget(this.deps.getPositions(), t.track.path)); }
    else this.deps.setPositions(remember(this.deps.getPositions(), t.track.path, t.audio.currentTime, t.audio.duration, this.now()));
    this.dropAudio(t.audio); this.applyVolume(); this.listenLast = this.listeningPoint(); this.schedulePreload();
  }

}
