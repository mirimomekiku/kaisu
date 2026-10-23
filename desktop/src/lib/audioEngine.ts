import { insertAfter, moveItem, removeAt, shuffleAround, unshuffle } from "./playQueue";
import { forget, remember, resumeAt, type Positions } from "./positions";
import { relocatePositions } from "./relocation";

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
  trackNumber?: number;
  discNumber?: number;
  albumArtist?: string;
  format?: string;
  sampleRate?: number;
  bitrate?: number | null;
  bitDepth?: number;
}

export type RepeatMode = "off" | "all" | "one";
/** Stop playing at a time, or when the current track ends. */
export type Sleep = { kind: "timer"; endsAt: number; fadeSeconds?: number; finishTrack?: boolean } | { kind: "track"; fadeSeconds?: number } | null;

export interface PlayerState {
  phase: "idle" | "loading" | "buffering" | "playing" | "paused" | "failed";
  errorDetails: string | null;
  notice: string | null;
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
  readonly error?: { code: number; message?: string } | null;
  setSinkId?: (id: string) => Promise<void>;
  preload?: string;
  load?: () => void;
  volume: number;
  muted: boolean;
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
  private state: PlayerState = { phase: "idle", errorDetails: null, notice: null, queue: [], index: -1, playing: false, loading: false, duration: 0, volume: 1, rate: 1, repeat: "off", shuffle: false, sleep: null, error: null };
  private time: PlayerTime = { position: 0, duration: 0 };
  private listeners = new Set<() => void>();
  private timeListeners = new Set<() => void>();
  private loadToken = 0;
  private wantsPlay = false;
  private resolving = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private skipUnavailable = false;
  private failedPaths = new Set<string>();
  private transitionFailures = new Set<string>();
  private fadeCurve: "linear" | "equalPower" = "linear";
  private albumTransitions = true;
  private sinkId = "";
  private outputRequest = 0;
  private outputTask: Promise<void> = Promise.resolve();
  private original: Track[] | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepFadeTimer: ReturnType<typeof setInterval> | null = null;
  private sleepGain = 1;
  private lastSaved = 0;
  private listenLast: { track: Track; at: number; position: number; rate: number; gain: number } | null = null;
  private listenPending = 0;
  private listenTrack: Track | null = null;
  private pendingSeek = 0;
  private seekRequested = false;
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
  private tail: { audio: AudioLike; track: Track; index: number; level: number; start: number; end: number; gain: number; lastAt: number; lastPosition: number; lastGain: number; pending: number } | null = null;
  private activeGain = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private levelMap = new Map<string, number>();

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.audio = deps.audio;
    this.handlers = [
      ["loadedmetadata", () => this.onMetadata()],
      ["durationchange", () => this.onMetadata()],
      ["playing", () => {
        if (!this.wantsPlay || !this.hasSource) { this.audio.pause(); return; }
        this.clearWatchdog(); this.applyVolume(); this.set({ playing: true, loading: false, error: null, errorDetails: null }); this.listenLast = this.listeningPoint();
        if (this.tail?.audio.paused) {
          const tail = this.tail;
          tail.lastAt = this.now(); tail.lastPosition = tail.audio.currentTime;
          void tail.audio.play().catch(() => { if (this.tail === tail) this.finishTail(false); });
        }
      }],
      ["pause", () => this.onPause()],
      ["waiting", () => { if (!this.wantsPlay || !this.hasSource) return; this.sampleListening(true); this.listenLast = null; this.sampleTail(true); this.tail?.audio.pause(); this.set({ loading: true }); this.armWatchdog(); }],
      ["canplay", () => { if (this.hasSource && !this.resolving && this.state.playing) this.set({ loading: false }); }],
      ["volumechange", () => this.applyVolume()],
      ["timeupdate", () => this.onTime()],
      ["ended", () => this.onEnded()],
      ["error", () => this.onError()],
    ];
    this.bindAudio(this.audio);
    this.applyVolume();
  }

  dispose() {
    this.disposed = true;
    this.wantsPlay = false; this.clearWatchdog(); this.outputRequest++;
    if (this.transitionTimer) clearInterval(this.transitionTimer); this.transitionTimer = null;
    this.sampleListening(true);
    this.cancelPreload(); this.finishTail(false);
    for (const audio of [...this.bound.keys()]) { this.unbindAudio(audio); audio.pause(); audio.src = ""; }
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    if (this.sleepFadeTimer) clearInterval(this.sleepFadeTimer);
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
    this.state.phase = this.state.error ? "failed" : this.state.index < 0 ? "idle" : this.state.loading ? this.state.playing ? "buffering" : "loading" : this.state.playing ? "playing" : "paused";
    this.listeners.forEach((fn) => fn());
    this.schedulePreload(); this.refreshTransitionTimer();
  }

  private setTime(position: number, duration: number) {
    duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    position = Number.isFinite(position) ? clamp(position, 0, duration || Math.max(0, position)) : 0;
    if (position === this.time.position && duration === this.time.duration) return;
    this.time = { position, duration };
    this.timeListeners.forEach((fn) => fn());
  }

  // ---- playing --------------------------------------------------------------------------------

  /** Plays `tracks`, starting from `start`, instead of whatever was queued. */
  play(tracks: Track[], start = 0) {
    if (tracks.length === 0) return;
    this.saveNow();
    this.failedPaths.clear(); this.transitionFailures.clear();
    this.original = null;
    let queue = tracks;
    let index = Number.isFinite(start) ? clamp(Math.trunc(start), 0, tracks.length - 1) : 0;
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
    const i = Number.isFinite(index) ? clamp(Math.trunc(index), 0, tracks.length - 1) : 0;
    this.original = null;
    this.set({ queue: tracks, index: i, duration: tracks[i].duration ?? 0 });
    this.pendingSeek = Number.isFinite(position) ? Math.max(0, position) : 0;
    this.seekRequested = true;
    this.unloaded = true;
    this.setTime(this.pendingSeek, tracks[i].duration ?? 0);
  }

  /**
   * Opens the track at `index`. By default it first saves where the previous one was, and starts from where this one was
   * left last time; `usePending` starts from the position a restored queue was waiting at instead.
   */
  private async load(index: number, autoplay: boolean, { usePending = false, save = true } = {}) {
    if (this.disposed) return;
    const track = this.state.queue[index];
    if (!track) return;
    if (this.editingFiles.has(track.path)) { this.pause(); this.set({ error: "Wait for this file to finish saving before playing it.", loading: false, playing: false }); return; }
    const token = ++this.loadToken;
    if (save) this.saveNow();
    this.cancelPreload(); this.finishTail(false);
    this.wantsPlay = autoplay; this.resolving = true;
    this.hasSource = false;
    // Each native source gets its own element so late decoder events cannot affect a new track.
    if (this.deps.createAudio && this.audio.src) { const old = this.audio; this.audio = this.deps.createAudio(); this.dropAudio(old); this.bindAudio(this.audio); }
    this.listenLast = null;
    if (!usePending) { this.pendingSeek = 0; this.seekRequested = false; }
    this.unloaded = false;
    this.set({ index, loading: true, error: null, errorDetails: null, playing: false, duration: track.duration ?? 0 });
    this.armWatchdog();
    // Start/resume the context while this call still belongs to the user's play gesture.
    this.setTime(0, track.duration ?? 0);
    this.audio.pause();
    let src: string;
    try {
      src = await this.deps.resolve(track);
      if (token !== this.loadToken || this.disposed) return;
      await this.routeAudio(this.audio);
    } catch (e) {
      if (token === this.loadToken) this.fail((e as { name?: string })?.name === "NotAllowedError" ? "Press play to start the music." : errorText(e), `Opening media: ${errorText(e)}`, (e as { name?: string })?.name !== "NotAllowedError");
      return;
    }
    if (token !== this.loadToken) return;
    this.resolving = false;
    if (this.pendingSeek === 0 && !this.seekRequested) this.pendingSeek = resumeAt(this.deps.getPositions(), track.path);
    this.audio.src = src;
    this.hasSource = true;
    this.audio.playbackRate = this.state.rate;
    this.applyVolume();
    if (!autoplay) {
      this.clearWatchdog();
      this.set({ loading: false });
      return;
    }
    try {
      await this.audio.play();
    } catch (e) {
      const why = playbackError(e);
      if (token === this.loadToken && this.wantsPlay && why) this.fail(why, `Starting playback: ${errorText(e)}`, (e as { name?: string })?.name !== "NotAllowedError");
      else if (token === this.loadToken && this.wantsPlay) { this.pause(); }
    }
  }

  toggle() {
    if (this.state.index < 0) return;
    if (this.state.loading || this.wantsPlay || this.state.playing) { this.pause(); return; }
    if (this.unloaded) {
      void this.load(this.state.index, true, { usePending: true });
    } else if (this.state.error) {
      this.failedPaths.clear(); this.transitionFailures.delete(this.current!.path);
      void this.load(this.state.index, true);
    } else if (this.state.playing) {
      this.pause();
    } else {
      const token = this.loadToken; const audio = this.audio;
      this.wantsPlay = true; this.set({ loading: true }); this.armWatchdog();
      const start = () => token === this.loadToken && audio === this.audio && this.wantsPlay ? audio.play() : Promise.resolve();
      const resumed = start();
      void resumed.catch((e) => {
        if (token !== this.loadToken || audio !== this.audio || !this.wantsPlay) return;
        const why = playbackError(e);
        if (why) this.fail(why, `Resuming playback: ${errorText(e)}`, (e as { name?: string })?.name !== "NotAllowedError");
        else this.pause();
      });
    }
  }

  pause() {
    this.wantsPlay = false; this.clearWatchdog();
    if (this.promoting) this.cancelPreload(false);
    this.sampleTail(true); this.tail?.audio.pause();
    if (this.resolving) {
      this.loadToken++; this.resolving = false;
      this.unloaded = true; this.hasSource = false; this.pendingSeek = resumeAt(this.deps.getPositions(), this.current?.path ?? "");
      this.audio.src = "";
    }
    this.audio.pause();
    this.set({ playing: false, loading: false });
  }

  resume() {
    if (!this.state.playing) this.toggle();
  }

  next() {
    this.failedPaths.clear();
    const { index, queue, repeat } = this.state;
    if (index + 1 < queue.length) void this.load(index + 1, true);
    else if (repeat === "all" && queue.length > 0) void this.load(0, true);
  }

  previous() {
    this.failedPaths.clear();
    const { index, queue, repeat } = this.state;
    if (this.audio.currentTime > RESTART_AFTER_SECONDS || queue.length === 0) this.seek(0);
    else if (index > 0) void this.load(index - 1, true);
    else if (repeat === "all") void this.load(queue.length - 1, true);
    else this.seek(0);
  }

  /** Plays the item at `index` of the queue now. */
  jump(index: number) {
    this.failedPaths.clear();
    if (Number.isInteger(index) && index >= 0 && index < this.state.queue.length) void this.load(index, true);
  }

  seek(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    if (this.promoting) this.cancelPreload(false);
    this.finishTail(false);
    this.sampleListening(true);
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    const t = clamp(seconds, 0, d > 0 ? d : seconds);
    if (this.unloaded || this.resolving || this.audio.readyState === 0) { this.pendingSeek = t; this.seekRequested = true; }
    else this.audio.currentTime = t;
    this.listenLast = this.listeningPoint();
    this.setTime(t, this.time.duration);
  }

  skip(delta: number = SKIP_SECONDS) {
    this.seek((this.unloaded ? this.pendingSeek : this.audio.currentTime) + delta);
  }

  // ---- settings of the player -----------------------------------------------------------------

  setRate(rate: number) {
    if (!Number.isFinite(rate)) return;
    this.finishTail(false); this.cancelPreload();
    this.sampleListening(true);
    const r = Math.round(clamp(rate, 0.5, 2) * 100) / 100;
    this.audio.playbackRate = r;
    this.set({ rate: r });
    this.listenLast = this.listeningPoint();
  }

  setVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.set({ volume: clamp(volume, 0, 1) });
    this.applyVolume();
  }

  /** Makes loud tracks quieter by `db` decibels (never louder). 0 turns it off. */
  setLevelGain(db: number) {
    this.levelFactor = Math.pow(10, Math.min(0, Number.isFinite(db) ? db : 0) / 20);
    this.applyVolume();
  }

  private applyVolume() {
    // WebKit can report an initial native volume of zero after creating its
    // output. Keep it in sync with the player's default or saved volume.
    const volume = clamp(this.state.volume * this.levelFactor * this.activeGain * this.sleepGain, 0, 1);
    if (this.audio.muted) this.audio.muted = false;
    if (this.audio.volume !== volume) this.audio.volume = volume;
    if (this.tail) {
      const tailVolume = clamp(this.state.volume * this.tail.level * this.tail.gain * this.sleepGain, 0, 1);
      if (this.tail.audio.volume !== tailVolume) this.tail.audio.volume = tailVolume;
    }
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
    const rate = Number.isFinite(s.rate) ? clamp(s.rate, 0.5, 2) : 1;
    this.audio.playbackRate = rate;
    this.set({ volume: Number.isFinite(s.volume) ? clamp(s.volume, 0, 1) : 1, rate, repeat: ["one", "all"].includes(s.repeat) ? s.repeat : "off", shuffle: s.shuffle === true });
    this.applyVolume();
  }

  /** `{ minutes }` stops after that long, `"track"` when the current track ends, `null` cancels. */
  setSleep(spec: { minutes: number; fadeSeconds?: number; finishTrack?: boolean } | "track" | null, trackFadeSeconds = 0) {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (this.sleepFadeTimer) clearInterval(this.sleepFadeTimer);
    this.sleepFadeTimer = null; this.sleepGain = 1; this.applyVolume();
    if (spec === null) return this.set({ sleep: null });
    if (spec === "track") {
      this.cancelPreload(false);
      const fadeSeconds = Number.isFinite(trackFadeSeconds) ? clamp(trackFadeSeconds, 0, 60) : 0;
      this.set({ sleep: { kind: "track", ...(fadeSeconds > 0 ? { fadeSeconds } : {}) } });
      if (fadeSeconds > 0) { this.sleepFadeTimer = setInterval(() => this.updateSleepGain(), 100); this.updateSleepGain(); }
      return;
    }
    const ms = (Number.isFinite(spec.minutes) ? Math.max(1, spec.minutes) : 1) * 60_000;
    const fadeSeconds = Number.isFinite(spec.fadeSeconds) ? clamp(spec.fadeSeconds!, 0, ms / 1000) : 0;
    this.set({ sleep: { kind: "timer", endsAt: this.now() + ms, fadeSeconds, finishTrack: !!spec.finishTrack } });
    if (fadeSeconds > 0) this.sleepFadeTimer = setInterval(() => this.updateSleepGain(), 100);
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      if (spec.finishTrack && this.current && this.state.playing) {
        this.cancelPreload(false);
        // If the deadline lands in a crossfade, finish the song shown as current.
        this.finishTail(false);
        this.set({ sleep: { kind: "track", fadeSeconds } }); this.updateSleepGain();
      } else {
        // An unresolved source must not start playing after the sleep deadline.
        if (this.current && this.state.loading) {
          const release = this.releaseFiles([this.current.path]); release();
        }
        this.pause(); this.setSleep(null);
      }
    }, ms);
  }

  private updateSleepGain() {
    const sleep = this.state.sleep;
    let gain = 1;
    if (sleep?.fadeSeconds) {
      if (sleep.kind === "timer" && !sleep.finishTrack) gain = clamp((sleep.endsAt - this.now()) / (sleep.fadeSeconds * 1000), 0, 1);
      else if (sleep.kind === "track" && Number.isFinite(this.audio.duration)) gain = clamp((this.audio.duration - this.audio.currentTime) / (sleep.fadeSeconds * this.state.rate), 0, 1);
    }
    this.sleepGain = gain; this.applyVolume();
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
    if (!Number.isInteger(at)) return;
    const { queue, index, playing } = this.state;
    const r = removeAt(queue, index, at);
    if (r.queue === queue) return;
    this.saveNow();
    if (this.original) this.original = this.original.filter((t) => t !== queue[at]);
    if (r.queue.length === 0) return this.clear();
    if (r.removedCurrent) this.loadToken++;
    this.set({ queue: r.queue, index: r.current });
    if (r.removedCurrent) {
      if (playing) void this.load(r.current, true, { save: false });
      else {
        this.pause();
        this.hasSource = false; this.audio.src = "";
        this.unloaded = true;
        this.pendingSeek = 0; this.seekRequested = true;
        this.set({ playing: false, loading: false, error: null, errorDetails: null, duration: r.queue[r.current].duration ?? 0 });
        this.setTime(0, r.queue[r.current].duration ?? 0);
      }
    }
  }

  move(from: number, to: number) {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    const m = moveItem(this.state.queue, this.state.index, from, to);
    if (m.queue !== this.state.queue) this.set({ queue: m.queue, index: m.current });
  }

  clear() {
    this.loadToken++;
    this.wantsPlay = false; this.resolving = false; this.clearWatchdog(); this.failedPaths.clear();
    this.saveNow();
    this.setSleep(null);
    this.cancelPreload(); this.finishTail(false);
    this.hasSource = false;
    this.audio.pause();
    this.audio.src = "";
    this.original = null;
    this.unloaded = false;
    this.pendingSeek = 0;
    this.seekRequested = false;
    this.set({ queue: [], index: -1, playing: false, loading: false, duration: 0, error: null, errorDetails: null, notice: null });
    this.setTime(0, 0);
  }

  // ---- what the audio element reports ---------------------------------------------------------

  private onMetadata() {
    if (!this.hasSource) return;
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) {
      if (d !== this.state.duration) this.set({ duration: d });
      if ((this.seekRequested || this.pendingSeek > 0) && this.pendingSeek < d) {
        this.audio.currentTime = this.pendingSeek;
        this.setTime(this.pendingSeek, d);
      }
      this.pendingSeek = 0;
      this.seekRequested = false;
    }
  }

  private onTime() {
    if (!this.hasSource) return;
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
    const code = this.audio.error?.code;
    this.fail(code === 2 ? "The audio file could not be read. Check that its drive is connected." : CANT_PLAY, `Media error ${code ?? "unknown"}: ${this.audio.error?.message || "No decoder details supplied."}`);
  }

  private clearWatchdog() { if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = null; }
  private armWatchdog() { this.clearWatchdog(); this.watchdog = setTimeout(() => { this.watchdog = null; if (this.wantsPlay && this.state.loading) this.fail("Playback took too long to start. Retry or check the file's drive.", "No playback progress for 30 seconds."); }, 30000); }

  private fail(message: string, details: string, allowSkip = true) {
    this.clearWatchdog(); this.resolving = false;
    if (this.restoreOutgoing(message)) return;
    const wanted = this.wantsPlay;
    this.wantsPlay = false; this.loadToken++;
    this.sampleListening(true);
    this.listenLast = null;
    this.cancelPreload(false); this.finishTail(false); this.audio.pause();
    const path = this.current?.path; if (path) this.failedPaths.add(path);
    this.set({ playing: false, loading: false, error: message, errorDetails: details });
    if (wanted && allowSkip && this.skipUnavailable && this.state.sleep?.kind !== "track") {
      const { queue, index } = this.state;
      const next = Array.from({ length: queue.length - 1 }, (_, i) => (index + i + 1) % queue.length).find((i) => !this.failedPaths.has(queue[i].path) && !this.editingFiles.has(queue[i].path));
      if (next !== undefined) { this.set({ notice: `Skipped ${this.current?.title}: ${message}` }); void this.load(next, true, { save: false }); }
      else this.set({ notice: "Stopped: no playable tracks remain in this queue." });
    }
  }

  private onEnded() {
    if (!this.hasSource || (!this.wantsPlay && !this.promoting)) return;
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
      this.wantsPlay = false;
      this.set({ playing: false }); this.setSleep(null);
      this.setTime(0, this.time.duration);
      return;
    }
    if (repeat === "one") {
      this.audio.currentTime = 0;
      const token = this.loadToken;
      void this.audio.play().catch((e) => { if (token === this.loadToken && this.wantsPlay) this.fail(playbackError(e) ?? "Playback was interrupted.", errorText(e)); });
      return;
    }
    if (this.readyPrepared()) { void this.promote(false, true); return; }
    const { index, queue } = this.state;
    if (index + 1 < queue.length) void this.load(index + 1, true);
    else if (repeat === "all") void this.load(0, true);
    else {
      this.wantsPlay = false;
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
    const retryLoading = this.current?.path === from && this.state.loading;
    this.saveNow(); this.cancelPreload(); this.finishTail(false); this.listenLast = null;
    const positions = this.deps.getPositions();
    const next = relocatePositions(positions, from, to);
    if (next !== positions) this.deps.setPositions(next);
    const swap = (queue: Track[]) => queue.map((t) => t.path === from ? { ...t, path: to, cover: undefined } : t);
    if (this.original) this.original = swap(this.original);
    this.set({ queue: swap(this.state.queue) });
    if (retryLoading) void this.load(this.state.index, true, { save: false });
  }
  setTransitions(gapless: boolean, seconds: number) {
    const fade = gapless && Number.isFinite(seconds) ? clamp(seconds, 0, 12) : 0;
    if (this.gapless === gapless && this.crossfadeSeconds === fade) return;
    this.gapless = gapless; this.crossfadeSeconds = fade;
    this.cancelPreload(); this.finishTail(false); this.schedulePreload(); this.refreshTransitionTimer();
  }

  setPlaybackPolicy(skipUnavailable: boolean, curve: "linear" | "equalPower", preserveAlbums: boolean) {
    this.skipUnavailable = skipUnavailable;
    this.fadeCurve = curve === "equalPower" ? "equalPower" : "linear";
    this.albumTransitions = preserveAlbums;
  }

  updateTrackDetails(tracks: Track[]) {
    const info = new Map(tracks.map((track) => [track.path, track]));
    const swap = (queue: Track[]) => queue.map((track) => info.has(track.path) ? { ...track, ...info.get(track.path) } : track);
    if (this.original) this.original = swap(this.original);
    this.set({ queue: swap(this.state.queue) });
  }

  retry() { this.failedPaths.clear(); if (this.current) { this.transitionFailures.delete(this.current.path); void this.load(this.state.index, true); } }
  skipFailed() {
    const { index, queue } = this.state;
    if (queue.length > 1) { this.failedPaths.clear(); void this.load((index + 1) % queue.length, true); }
  }

  private async routeAudio(audio: AudioLike) {
    if (!audio.setSinkId) { if (this.sinkId) throw new Error("Audio output selection is not supported by this player."); return; }
    let id: string;
    do {
      id = this.sinkId;
      try { await audio.setSinkId(id); }
      catch (e) {
        if (!id) throw e;
        this.sinkId = "";
        await Promise.allSettled([...this.bound.keys()].map((deck) => deck.setSinkId?.("")));
        this.set({ notice: "The selected audio output is unavailable. Using the system default." });
      }
    } while (id !== this.sinkId && !this.disposed);
  }

  /** Serialize device switches across both decks. A partial failure falls back to the system output. */
  setOutputDevice(id: string): Promise<void> {
    const request = ++this.outputRequest;
    const task = this.outputTask.catch(() => {}).then(async () => {
      if (request !== this.outputRequest || this.disposed) return;
      this.sinkId = id;
      try { await Promise.all([...this.bound.keys()].map((audio) => {
        if (!audio.setSinkId) { if (id) throw new Error("This player does not support output selection."); return; }
        return audio.setSinkId(id);
      })); if (this.state.notice?.startsWith("The selected audio output is unavailable.")) this.set({ notice: null }); }
      catch (e) {
        this.sinkId = "";
        await Promise.allSettled([...this.bound.keys()].map((audio) => audio.setSinkId?.("")));
        this.set({ notice: "The selected audio output is unavailable. Using the system default." });
        throw e;
      }
    });
    this.outputTask = task; return task;
  }

  private restoreOutgoing(reason: string): boolean {
    const tail = this.tail;
    if (!tail || !(tail.audio.currentTime < tail.audio.duration) || !this.wantsPlay) return false;
    const index = this.state.queue[tail.index]?.path === tail.track.path ? tail.index : this.state.queue.findIndex((track) => track.path === tail.track.path);
    if (index < 0) return false;
    if (this.current) this.transitionFailures.add(this.current.path);
    this.sampleListening(true); this.sampleTail(true); this.listenLast = null;
    const broken = this.audio; this.tail = null;
    if (this.fadeTimer) clearInterval(this.fadeTimer); this.fadeTimer = null;
    this.audio = tail.audio; this.activeGain = 1; this.levelFactor = tail.level; this.loadToken++;
    this.dropAudio(broken); this.cancelPreload(false); this.hasSource = true;
    this.set({ index, playing: !this.audio.paused, loading: this.audio.paused, error: null, errorDetails: null, notice: `Kept playing ${tail.track.title}: the next song failed. ${reason}`, duration: this.audio.duration });
    this.setTime(this.audio.currentTime, this.audio.duration); this.applyVolume();
    if (this.audio.paused) {
      const token = this.loadToken;
      void this.audio.play().catch((e) => { if (token === this.loadToken && this.wantsPlay) this.fail(playbackError(e) ?? CANT_PLAY, errorText(e)); });
    }
    return true;
  }

  setLevelMap(levels: Map<string, number>) { this.levelMap = levels; }

  /** Release open handles before rewriting tags/artwork; resume remains available at the same position. */
  releaseFiles(paths: string[]) {
    const wanted = new Set(paths);
    for (const path of wanted) this.editingFiles.add(path);
    if (this.prepared && wanted.has(this.prepared.path)) this.cancelPreload();
    if (this.tail && wanted.has(this.tail.track.path)) this.finishTail(false);
    if (this.current && wanted.has(this.current.path) && !this.unloaded) {
      // Releasing the outgoing file also cancels an in-flight successor's play().
      this.cancelPreload(false);
      this.wantsPlay = false; this.clearWatchdog(); this.resolving = false;
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
        else if (type === "volumechange") this.applyVolume();
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
    const audio = this.deps.createAudio(); audio.preload = "auto"; audio.volume = 0; audio.muted = false; audio.playbackRate = this.state.rate;
    const start = resumeAt(this.deps.getPositions(), track.path);
    const prepared = { audio, index, path: track.path, token, ready: false, start }; this.prepared = prepared; this.bindAudio(audio);
    try {
      const src = await this.deps.resolve(track);
      if (this.prepared !== prepared || token !== this.preloadToken) { this.dropAudio(audio); return; }
      await this.routeAudio(audio);
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
    if (this.transitionFailures.has(p.path)) return;
    const current = this.current; const next = this.state.queue[p.index];
    if (this.albumTransitions && current?.album && current.album === next.album &&
      (current.albumArtist || current.artist) === (next.albumArtist || next.artist) &&
      current.trackNumber && next.trackNumber === current.trackNumber + 1 && (current.discNumber ?? 1) === (next.discNumber ?? 1)) return;
    if (p.start > 0 || !Number.isFinite(p.audio.duration) || p.audio.duration <= 0) return;
    const d = this.audio.duration;
    const fade = Math.min(this.crossfadeSeconds, d / (2 * this.state.rate), p.audio.duration / (2 * this.state.rate));
    const remaining = (d - this.audio.currentTime) / this.state.rate;
    if (remaining > 0 && remaining <= fade) void this.promote(true, false);
  }

  private async promote(crossfade: boolean, ended: boolean) {
    if (this.promoting || !this.readyPrepared()) return;
    const p = this.prepared!; const old = this.audio; const track = this.current!; const oldIndex = this.state.index;
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
        this.tail = { audio: old, track, index: oldIndex, level: oldLevel, start: old.currentTime, end: old.duration, gain: 1, lastAt: this.now(), lastPosition: old.currentTime, lastGain: 1, pending: 0 };
        this.activeGain = 0;
        this.fadeTimer = setInterval(() => this.tickFade(), 40);
      } else { this.dropAudio(old); this.activeGain = 1; }
      this.levelFactor = Math.pow(10, Math.min(0, this.levelMap.get(p.path) ?? 0) / 20);
      this.set({ index: p.index, playing: true, loading: false, error: null, errorDetails: null, duration: p.audio.duration });
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
    this.activeGain = this.fadeCurve === "equalPower" ? Math.sin(progress * Math.PI / 2) : progress;
    t.gain = this.fadeCurve === "equalPower" ? Math.cos(progress * Math.PI / 2) : 1 - progress;
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
