import { defaultCustomization, sanitizeCustomization, sanitizeCustomizationPresets, type CustomizationValues, type CustomizationPreset } from "./customization";
import { defaultPlaybackProfiles, sanitizePlaybackProfiles, type PlaybackProfile } from "./playbackProfiles";
import { settingsShape } from "./settingsValidation";
import { storageProblem, storageRecovered } from "./storageHealth";
import { sanitizeMusicPreferences, type MusicPreferences } from "./musicPreferences";
import { persistedDownload, redactText, sensitiveCustomArgs, REDACTED } from "./redact";
import { sanitizeDownloadQueue, safeConcurrency } from "./downloadValidation";
import { defaultEqualizer, sanitizeEqualizer, type EqualizerSettings } from "./equalizer";
import { load, type Store } from "@tauri-apps/plugin-store";
import { secretDelete, secretGet, secretSet } from "./api";
import { joinProxyPassword, splitProxyPassword } from "./proxy";
import type { AudioFormat, Browser, CloseMode, CoverMode, ExtraOptions, Layout, LyricsMode, MoveConflict, MoveMode, NameStyle, Preset, SearchSource, SponsorBlock } from "./api";
import { sanitizePresets, type FormatPreset } from "./presets";
import { sanitizePlaylists, type Playlist } from "./playlists";
import { sanitizeListening, type Listening } from "./listening";
import { sanitizePodcasts, type PodcastSubscription } from "./podcasts";
import type { HistorySort } from "./history";
import type { ScheduleRule } from "./schedule";
import type { RepeatMode, Track } from "./audioEngine";
import { sanitizePositions, type Positions } from "./positions";
import { sanitizeSiteRules, type SiteRule } from "./siteRules";

export type Mode = "simple" | "advanced";
export type SubtitleMode = "off" | "embed" | "file" | "both";
export type Theme = "system" | "aqua" | "graphite" | "dark";
export type MoveWhen = "done" | "manual";
export type MoveTypes = "all" | "audio" | "video";
export type Accent = "blue" | "orange" | "green" | "purple" | "pink" | "red" | "teal";
export const ACCENTS: Accent[] = ["blue", "orange", "green", "purple", "pink", "red", "teal"];

/** How a list of items is laid out. Not every list offers every view. */
export type ViewMode = "list" | "grid" | "compact" | "details";

export interface Settings extends CustomizationValues {
  customizationPresets: CustomizationPreset[];
  waveformSeek: boolean;
  resumeLongTracks: boolean;
  playbackProfiles: PlaybackProfile[];
  activePlaybackProfile: string;
  equalizer: EqualizerSettings;
  mode: Mode;
  outDir: string | null;
  autoUpdate: boolean;
  lastEngineCheck: number;
  viewSearch: ViewMode;
  viewQueue: ViewMode;
  viewHistory: ViewMode;
  // Advanced-only options (ignored in simple mode).
  concurrency: number;
  sponsorblock: SponsorBlock;
  cookiesBrowser: Browser | null;
  subtitleMode: SubtitleMode;
  /** Preferred subtitle languages, comma separated ("en, es"). */
  subtitleLangs: string;
  /** Fall back to automatically generated captions. */
  subtitleAuto: boolean;
  audioFormat: AudioFormat;
  /** "" = best, "0"-"9" or a bitrate like "192K". */
  audioQuality: string;
  audioNormalize: boolean;
  audioTrimSilence: boolean;
  /** Cover art for batch downloads (a single download can choose its own). */
  coverMode: Exclude<CoverMode, "custom">;
  lyricsMode: LyricsMode;
  /** The user agreed to send the artist and title of a song to a lyrics service (LRCLIB) to look its lyrics up. */
  lyricsConsent: boolean;
  /** Look for a newer Kaisu release (once a day) by reading the public releases page. Nothing is downloaded or installed. */
  appUpdateChecks: boolean;
  appUpdateLastCheck: number;
  /** The release the user dismissed, so the same one is not announced again. */
  appUpdateDismissed: string;
  globalRateLimit: string;
  fragmentBudget: number;
  downloadConflict: "keep_both" | "skip" | "replace";
  rateLimit: string;
  customArgs: string;
  verbose: boolean;
  // File organisation (both modes).
  layout: Layout;
  nameStyle: NameStyle;
  customName: string;
  /** Remove "(Official Video)" and similar from titles. */
  cleanTitles: boolean;
  playlistFolder: boolean;
  playlistNumbering: boolean;
  // Convenience.
  notifyWhenDone: boolean;
  warnDuplicates: boolean;
  /** Play loud songs a little quieter so the volume stays even. */
  levelVolume: boolean;
  gaplessPlayback: boolean;
  crossfadeSeconds: number;
  crossfadeCurve: "linear" | "equalPower";
  preserveAlbumTransitions: boolean;
  skipUnavailableTracks: boolean;
  audioOutputId: string;
  audioOutputLabel: string;
  watchClipboard: boolean;
  closeMode: CloseMode;
  theme: Theme;
  /** The highlight colour (buttons, selections, progress). */
  accent: Accent;
  /** Saved download choices. */
  presets: FormatPreset[];
  /** Tries again this many times after a network failure (0 = never). */
  autoRetries: number;
  /** Most downloads from one website at a time (0 = no limit). */
  perSiteLimit: number;
  // Moving finished downloads somewhere else (an external drive).
  moveEnabled: boolean;
  moveDir: string;
  moveMode: MoveMode;
  moveWhen: MoveWhen;
  moveTypes: MoveTypes;
  moveKeepLayout: boolean;
  moveConflict: MoveConflict;
  // Deleting old downloads.
  /** 0 = never. */
  autoDeleteDays: number;
  /** Also clean the folder downloads are moved to. */
  autoDeleteMoved: boolean;
  cleanupPermanent: boolean;
  // Network and searching.
  searchSource: SearchSource;
  proxy: string;
  schedule: ScheduleRule[];
  /** Advanced mode: downloads from certain sites or channels get their own kind, audio format and folder. */
  siteRules: SiteRule[];
  // History and onboarding.
  historySort: HistorySort;
  historySortDesc: boolean;
  tourSeen: boolean;
}

export interface HistoryItem {
  /** Files still waiting to be committed to these local playlists. */
  pendingPlaylistIds?: string[];
  profile?: string;
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  preset: Preset;
  path: string | null;
  timestamp: number;
  /** Set for partial downloads (e.g. "80-165"), so a clip isn't mistaken for the whole video. */
  clip?: string;
  /** Who published it. */
  channel?: string;
  /** Set when the finished file looked damaged or cut off. */
  flag?: string;
  /** Where a copy was made (or "skipped"), so a copied file isn't copied again. */
  transferred?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  ...defaultCustomization(), customizationPresets: [],
  waveformSeek: false, resumeLongTracks: true, playbackProfiles: defaultPlaybackProfiles(), activePlaybackProfile: "",
  equalizer: defaultEqualizer(),
  mode: "simple",
  outDir: null,
  autoUpdate: true,
  lastEngineCheck: 0,
  viewSearch: "details",
  viewQueue: "details",
  viewHistory: "details",
  concurrency: 2,
  sponsorblock: "off",
  cookiesBrowser: null,
  subtitleMode: "off",
  subtitleLangs: "en",
  subtitleAuto: true,
  audioFormat: "mp3",
  audioQuality: "",
  audioNormalize: false,
  audioTrimSilence: false,
  coverMode: "default",
  lyricsMode: "off",
  lyricsConsent: false,
  appUpdateChecks: true,
  appUpdateLastCheck: 0,
  appUpdateDismissed: "",
  globalRateLimit: "",
  fragmentBudget: 8,
  downloadConflict: "keep_both",
  rateLimit: "",
  customArgs: "",
  verbose: true,
  layout: "flat",
  nameStyle: "title_id",
  customName: "",
  cleanTitles: false,
  playlistFolder: true,
  playlistNumbering: true,
  notifyWhenDone: true,
  warnDuplicates: true,
  levelVolume: false,
  gaplessPlayback: true,
  crossfadeSeconds: 0,
  crossfadeCurve: "linear",
  preserveAlbumTransitions: true,
  skipUnavailableTracks: false,
  audioOutputId: "",
  audioOutputLabel: "System default",
  watchClipboard: true,
  closeMode: "downloads",
  theme: "aqua",
  accent: "blue",
  presets: [],
  autoRetries: 0,
  perSiteLimit: 0,
  moveEnabled: false,
  moveDir: "",
  moveMode: "move",
  moveWhen: "done",
  moveTypes: "all",
  moveKeepLayout: true,
  moveConflict: "keep_both",
  autoDeleteDays: 0,
  autoDeleteMoved: false,
  cleanupPermanent: false,
  searchSource: "youtube",
  proxy: "",
  schedule: [],
  siteRules: [],
  historySort: "date",
  historySortDesc: true,
  tourSeen: false,
};

/** A download that was unfinished when the app closed. Stored so it can be resumed next time. */
export interface SavedDownload {
  recoveryId?: string;
  estimatedBytes?: number;
  expectedVolume?: number;
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  preset: Preset;
  outDir: string;
  extra: ExtraOptions;
  status: string;
  progress: number;
  clipKey?: string;
  placeholderTitle?: boolean;
  channel?: string;
}

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= load("kaisu.json", { defaults: {}, autoSave: 200 }).catch((e) => { storePromise = null; throw e; }));
const blockedReads = new Set<string>();
const persistedValues = new Map<string, unknown>();
export const storageReadBlocked = (key: string) => blockedReads.has(key);
export async function readStored<T>(key: string): Promise<T | undefined> {
  try { const value = await (await getStore()).get<T>(key); persistedValues.set(key, value); blockedReads.delete(key); storageRecovered(`read:${key}`); return value; }
  catch (e) {
    blockedReads.add(key);
    storageProblem(`read:${key}`, `Kaisu could not read ${key}. Changes to it will not overwrite your saved data.`, async () => { await readStored(key); storageRecovered(`read:${key}`); location.reload(); });
    throw e;
  }
}
let writes: Promise<void> = Promise.resolve();
const pendingWrites = new Map<string, unknown>();
const backedUp = new Set<string>();
/** Serialized explicit saves surface disk errors; keep one previous, credential-free value. */
export function persist(key: string, value: unknown): Promise<void> {
  pendingWrites.set(key, value);
  const job = writes.then(async () => {
    if (blockedReads.has(key)) throw new Error("Saved data has not been read successfully.");
    const store = await getStore();
    const previous = persistedValues.get(key);
    if (!backedUp.has(key) && ["playlists", "playlistFolders", "musicPreferences", "listening", "positions", "listeningSessions"].includes(key) && previous !== undefined) { await store.set(`backup:${key}`, previous); backedUp.add(key); }
    await store.set(key, value);
    await store.save();
    persistedValues.set(key, value);
    if (pendingWrites.get(key) === value) pendingWrites.delete(key);
    storageRecovered(`write:${key}`);
  });
  writes = job.catch(() => {});
  return job.catch((e) => {
    storageProblem(`write:${key}`, `Changes to ${key} could not be saved. Keep Kaisu open and retry after checking disk space and folder permissions.`, async () => { await persist(key, pendingWrites.get(key) ?? value); });
    throw e;
  });
}
const flushers = new Set<() => Promise<void>>();
export function registerStorageFlush(fn: () => Promise<void>) { flushers.add(fn); return () => { flushers.delete(fn); }; }
export async function flushStorage() {
  await Promise.all([...flushers].map((fn) => fn()));
  await saving;
  await writes;
  if (pendingWrites.size) throw new Error("Some changes have not been saved.");
  try { await (await getStore()).save(); storageRecovered("write:flush"); }
  catch (e) { storageProblem("write:flush", "Kaisu could not finish saving before exit. Keep it open and retry.", flushStorage); throw e; }
}
export async function resetSavedSettings() {
  await Promise.allSettled([secretDelete("proxy-password"), secretDelete("download-custom-args")]);
  storedPassword = null; blockedReads.delete("settings"); await persist("settings", DEFAULT_SETTINGS);
}

export async function loadSettings(): Promise<Settings> {
  try {
    const saved = await readStored<Partial<Settings> & { subtitles?: boolean }>("settings");
    const merged = settingsShape(saved, DEFAULT_SETTINGS);
    Object.assign(merged, sanitizeCustomization(saved));
    merged.customizationPresets = sanitizeCustomizationPresets(saved?.customizationPresets);
    merged.playbackProfiles = sanitizePlaybackProfiles(saved?.playbackProfiles);
    if (!merged.playbackProfiles.some((p) => p.id === merged.activePlaybackProfile)) merged.activePlaybackProfile = "";
    merged.presets = sanitizePresets(saved?.presets);
    merged.concurrency = safeConcurrency(merged.concurrency);
    merged.globalRateLimit = typeof merged.globalRateLimit === "string" ? merged.globalRateLimit : "";
    merged.fragmentBudget = Math.max(1, Math.min(24, Math.round(Number(merged.fragmentBudget) || 8)));
    if (!["keep_both", "skip", "replace"].includes(merged.downloadConflict)) merged.downloadConflict = "keep_both";
    merged.autoRetries = Math.min(5, Math.max(0, Math.round(Number(merged.autoRetries) || 0)));
    merged.perSiteLimit = Math.min(6, Math.max(0, Math.round(Number(merged.perSiteLimit) || 0)));
    if (!["system", "aqua", "graphite", "dark"].includes(merged.theme)) merged.theme = "aqua";
    if (!ACCENTS.includes(merged.accent)) merged.accent = "blue";
    if (!["move", "copy"].includes(merged.moveMode)) merged.moveMode = "move";
    if (!["done", "manual"].includes(merged.moveWhen)) merged.moveWhen = "done";
    if (!["all", "audio", "video"].includes(merged.moveTypes)) merged.moveTypes = "all";
    if (!["keep_both", "skip", "replace"].includes(merged.moveConflict)) merged.moveConflict = "keep_both";
    if (typeof merged.moveDir !== "string") merged.moveDir = "";
    merged.autoDeleteDays = Math.min(3650, Math.max(0, Math.round(Number(merged.autoDeleteDays) || 0)));
    // Before language choice existed there was one on/off switch for English subtitles.
    if (saved?.subtitles === true && saved.subtitleMode === undefined) merged.subtitleMode = "embed";
    merged.gaplessPlayback = merged.gaplessPlayback !== false;
    merged.equalizer = sanitizeEqualizer(saved?.equalizer);
    merged.crossfadeSeconds = Math.min(12, Math.max(0, Number(merged.crossfadeSeconds) || 0));
    merged.crossfadeCurve = merged.crossfadeCurve === "equalPower" ? "equalPower" : "linear";
    merged.preserveAlbumTransitions = merged.preserveAlbumTransitions !== false;
    merged.skipUnavailableTracks = merged.skipUnavailableTracks === true;
    merged.audioOutputId = typeof merged.audioOutputId === "string" ? merged.audioOutputId.slice(0, 1024) : "";
    merged.audioOutputLabel = typeof merged.audioOutputLabel === "string" ? merged.audioOutputLabel.slice(0, 200) : "System default";
    merged.cleanupPermanent = merged.cleanupPermanent === true;
    merged.lyricsConsent = merged.lyricsConsent === true;
    merged.siteRules = sanitizeSiteRules(saved?.siteRules);
    merged.proxy = typeof merged.proxy === "string" ? merged.proxy : "";
    if (merged.customArgs === REDACTED) {
      try { merged.customArgs = await secretGet("download-custom-args") ?? ""; customArgsSecretUnreadable = false; } catch { merged.customArgs = ""; customArgsSecretUnreadable = true; }
    }
    const inFile = splitProxyPassword(merged.proxy).password !== null || sensitiveCustomArgs(merged.customArgs);
    merged.proxy = await restoreProxyPassword(merged.proxy);
    if (inFile) await saveSettings(merged); // an older file kept the password in plain text; move it into the store now
    return merged;
  } catch (e) {
    console.warn("Could not read settings", e);
    return DEFAULT_SETTINGS;
  }
}

// ---- the proxy password ----
// The password in a proxy address (socks5://user:password@host) is kept in the system's credential store, and the settings
// file holds the address without it. If there is no credential store, it stays in the file as it always did.

/** The password the credential store currently holds, so it is only written when it changes. */
let storedPassword: string | null = null;

/** Puts the stored password back into the address (and moves one still sitting in the file into the store). */
async function restoreProxyPassword(proxy: string): Promise<string> {
  const { address, password } = splitProxyPassword(proxy);
  if (password !== null) return proxy; // an older file: saveSettings moves it into the store
  if (address === "") return address;
  try {
    const kept = await secretGet("proxy-password");
    storedPassword = kept;
    return kept ? joinProxyPassword(address, kept) : address;
  } catch {
    return address; // no credential store
  }
}

/** What goes into the settings file: the proxy without its password, once the credential store has the password. */
async function withoutSecrets(settings: Settings): Promise<Settings> {
  const { address, password } = splitProxyPassword(settings.proxy);
  try {
    if (password !== null) {
      if (password !== storedPassword) {
        await secretSet("proxy-password", password);
        storedPassword = password;
      }
      return { ...settings, proxy: address };
    }
    if (storedPassword !== null) {
      await secretDelete("proxy-password");
      storedPassword = null;
    }
  } catch (e) {
    console.warn("The system's password store isn't available; the proxy password stays in the settings file", e);
  }
  return settings;
}

let saving: Promise<void> = Promise.resolve();

/** Saves one after another, so a quick run of edits (typing a password) can't land out of order. */
/** The stored custom-arguments secret could not be read, so an empty value in memory must not erase it. */
let customArgsSecretUnreadable = false;

export function saveSettings(settings: Settings): Promise<void> {
  saving = saving.then(async () => {
    try {
      // Nothing may touch the credential store unless the settings file itself is readable and writable.
      if (blockedReads.has("settings")) throw new Error("Saved data has not been read successfully.");
      let safe = await withoutSecrets(settings);
      if (sensitiveCustomArgs(settings.customArgs)) {
        try { await secretSet("download-custom-args", settings.customArgs); }
        catch { console.warn("Custom header credentials will need to be entered again after restart; the credential store is unavailable."); }
        safe = { ...safe, customArgs: REDACTED };
      } else if (!customArgsSecretUnreadable) {
        try { await secretDelete("download-custom-args"); } catch { /* No plaintext fallback. */ }
      }
      await persist("settings", safe);
    } catch (e) {
      console.warn("Could not save settings", e);
    }
  });
  return saving;
}

export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const items = (await readStored<HistoryItem[]>("history")) ?? [];
    // Entries saved before audio formats existed used the preset name "audio_mp3".
    const safe = items.map((h) => ({ ...h, preset: (h.preset as string) === "audio_mp3" ? "audio" as Preset : h.preset, url: redactText(h.url), title: redactText(h.title), thumbnail: redactText(h.thumbnail), profile: h.profile ? redactText(h.profile) : h.profile, flag: h.flag ? redactText(h.flag) : h.flag }));
    if (JSON.stringify(items) !== JSON.stringify(safe)) await saveHistory(safe);
    return safe;
  } catch (e) {
    console.warn("Could not read history", e);
    return [];
  }
}

export async function saveHistory(history: HistoryItem[]) {
  try {
    await persist("history", history.map((item) => ({ ...item, url: redactText(item.url), title: redactText(item.title), thumbnail: redactText(item.thumbnail), profile: item.profile ? redactText(item.profile) : item.profile, flag: item.flag ? redactText(item.flag) : item.flag })));
  } catch (e) {
    console.warn("Could not save history", e);
  }
}

/** What the music player keeps between sessions: the queue, where it was, and its settings. */
export interface SavedPlayer {
  truncated?: number;
  queue: Track[];
  index: number;
  /** Seconds into the current track. */
  position: number;
  volume: number;
  rate: number;
  repeat: RepeatMode;
  shuffle: boolean;
}

const asTrack = (t: unknown): Track | null => {
  const r = t as Partial<Track> | null;
  if (!r || typeof r.path !== "string" || typeof r.title !== "string") return null;
  return {
    path: r.path,
    title: r.title,
    ...(typeof r.fileRevision === "string" ? { fileRevision: r.fileRevision.slice(0, 160) } : {}),
    artist: typeof r.artist === "string" ? r.artist : undefined,
    album: typeof r.album === "string" ? r.album : undefined,
    duration: typeof r.duration === "number" && Number.isFinite(r.duration) ? r.duration : undefined,
    albumArtist: typeof r.albumArtist === "string" ? r.albumArtist.slice(0, 1000) : undefined,
    format: typeof r.format === "string" ? r.format.slice(0, 40) : undefined,
    ...Object.fromEntries((["trackNumber", "discNumber", "sampleRate", "bitrate", "bitDepth"] as const).map((key) => [key, typeof r[key] === "number" && Number.isFinite(r[key]) && r[key]! > 0 && r[key]! <= 1e7 ? r[key] : undefined])),
  };
};

/** Keeps only what is shaped like saved player state; anything else means "nothing saved". */
export function sanitizePlayer(raw: unknown): SavedPlayer | null {
  const r = raw as Partial<SavedPlayer> | null;
  if (!r || !Array.isArray(r.queue)) return null;
  const all = r.queue.map(asTrack).filter((t): t is Track => t !== null);
  const originalIndex = typeof r.index === "number" && Number.isFinite(r.index) ? Math.max(0, Math.min(all.length - 1, Math.round(r.index))) : 0;
  const start = Math.min(Math.max(0, originalIndex - 1000), Math.max(0, all.length - 2000));
  const queue = all.slice(start, start + 2000);
  if (queue.length === 0) return null;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return {
    queue,
    ...(all.length > queue.length ? { truncated: all.length - queue.length } : {}),
    index: originalIndex - start,
    position: num(r.position, 0, 1e7, 0),
    volume: num(r.volume, 0, 1, 1),
    rate: num(r.rate, 0.5, 2, 1),
    repeat: r.repeat === "all" || r.repeat === "one" ? r.repeat : "off",
    shuffle: r.shuffle === true,
  };
}

export async function loadPlayer(): Promise<SavedPlayer | null> {
  try {
    return sanitizePlayer(await readStored("player"));
  } catch (e) {
    console.warn("Could not read the player state", e);
    return null;
  }
}

export async function savePlayer(player: SavedPlayer | null) {
  try {
    await persist("player", player);
  } catch (e) {
    console.warn("Could not save the player state", e);
  }
}

export async function loadPlaylists(): Promise<Playlist[]> {
  try {
    return sanitizePlaylists(await readStored("playlists"));
  } catch (e) {
    console.warn("Could not read the playlists", e);
    return [];
  }
}

export async function loadListening(): Promise<Listening> {
  try { return sanitizeListening(await readStored("listening")); }
  catch (e) { console.warn("Could not read listening history", e); return {}; }
}
export async function saveListening(listening: Listening) {
  try { await persist("listening", listening); }
  catch (e) { console.warn("Could not save listening history", e); }
}
export async function loadLibraryWatch(): Promise<boolean> {
  try { return (await readStored("libraryWatch")) !== false; }
  catch { return true; }
}
export async function saveLibraryWatch(watch: boolean) {
  try { await persist("libraryWatch", watch); }
  catch (e) { console.warn("Could not save library watching", e); }
}

export async function loadPodcasts(): Promise<PodcastSubscription[]> {
  try {
    return sanitizePodcasts(await readStored("podcasts"));
  } catch (e) {
    console.warn("Could not read podcasts", e);
    return [];
  }
}

export async function savePodcasts(podcasts: PodcastSubscription[]) {
  try {
    await persist("podcasts", podcasts);
  } catch (e) {
    console.warn("Could not save podcasts", e);
  }
}

export async function savePlaylists(playlists: Playlist[]) {
  try {
    await persist("playlists", playlists);
    return true;
  } catch (e) {
    console.warn("Could not save the playlists", e);
    return false;
  }
}

export async function loadPlaylistFolders(): Promise<unknown> {
  try { return await readStored("playlistFolders"); } catch { return []; }
}
export async function savePlaylistFolders(folders: string[]) {
  try { await persist("playlistFolders", folders); }
  catch (e) { console.warn("Could not save playlist folders", e); }
}

export async function loadPositions(): Promise<Positions> {
  try {
    return sanitizePositions(await readStored("positions"));
  } catch (e) {
    console.warn("Could not read playback positions", e);
    return {};
  }
}

export async function savePositions(positions: Positions) {
  try {
    await persist("positions", positions);
  } catch (e) {
    console.warn("Could not save playback positions", e);
  }
}

export async function loadQueue(): Promise<SavedDownload[]> {
  try {
    const raw = await readStored<unknown>("queue");
    const store = await getStore();
    const saved = Array.isArray(raw) ? raw : [];
    const queue = queueWithoutProxy(sanitizeDownloadQueue(saved));
    if (JSON.stringify(saved) !== JSON.stringify(queue)) {
      try {
        await store.set("queue", queue);
        // Finish the migration before returning: old credentials must not remain on disk.
        await store.save();
      } catch (e) { storageProblem("write:queue", "Old queue credentials could not be removed from disk. Keep Kaisu open and retry.", async () => { await persist("queue", queue); }); console.warn("Could not remove saved queue credentials", e); }
    }
    return queue;
  } catch (e) {
    console.warn("Could not read the saved queue", e);
    return [];
  }
}

export async function saveQueue(queue: SavedDownload[]) {
  try {
    await persist("queue", queueWithoutProxy(queue));
    return true;
  } catch (e) {
    console.warn("Could not save the queue", e);
    return false;
  }
}

/** Network credentials belong to current settings, never to a saved download. */
export function queueWithoutProxy(queue: SavedDownload[]): SavedDownload[] {
  return queue.map(persistedDownload);
}

export async function loadMusicPreferences(): Promise<MusicPreferences> {
  try { return sanitizeMusicPreferences(await readStored("musicPreferences")); }
  catch { return {}; }
}
export async function saveMusicPreferences(value: MusicPreferences) {
  try { await persist("musicPreferences", value); }
  catch (e) { console.warn("Could not save favorites and ratings", e); }
}
