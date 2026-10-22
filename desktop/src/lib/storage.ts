import { load, type Store } from "@tauri-apps/plugin-store";
import { secretDelete, secretGet, secretSet } from "./api";
import { joinProxyPassword, splitProxyPassword } from "./proxy";
import type { AudioFormat, Browser, CloseMode, CoverMode, ExtraOptions, Layout, LyricsMode, MoveConflict, MoveMode, NameStyle, Preset, SearchSource, SponsorBlock } from "./api";
import { sanitizePresets, type FormatPreset } from "./presets";
import { sanitizePlaylists, type Playlist } from "./playlists";
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

export interface Settings {
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

const MAX_HISTORY = 500;
let storePromise: Promise<Store> | null = null;

const getStore = () => (storePromise ??= load("kaisu.json", { defaults: {}, autoSave: 200 }));

export async function loadSettings(): Promise<Settings> {
  try {
    const saved = await (await getStore()).get<Partial<Settings> & { subtitles?: boolean }>("settings");
    const merged: Settings = { ...DEFAULT_SETTINGS, ...saved };
    merged.presets = sanitizePresets(saved?.presets);
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
    merged.lyricsConsent = merged.lyricsConsent === true;
    merged.siteRules = sanitizeSiteRules(saved?.siteRules);
    merged.proxy = typeof merged.proxy === "string" ? merged.proxy : "";
    const inFile = splitProxyPassword(merged.proxy).password !== null;
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
export function saveSettings(settings: Settings): Promise<void> {
  saving = saving.then(async () => {
    try {
      await (await getStore()).set("settings", await withoutSecrets(settings));
    } catch (e) {
      console.warn("Could not save settings", e);
    }
  });
  return saving;
}

export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const items = (await (await getStore()).get<HistoryItem[]>("history")) ?? [];
    // Entries saved before audio formats existed used the preset name "audio_mp3".
    return items.map((h) => ((h.preset as string) === "audio_mp3" ? { ...h, preset: "audio" as Preset } : h));
  } catch (e) {
    console.warn("Could not read history", e);
    return [];
  }
}

export async function saveHistory(history: HistoryItem[]) {
  try {
    await (await getStore()).set("history", history.slice(0, MAX_HISTORY));
  } catch (e) {
    console.warn("Could not save history", e);
  }
}

/** What the music player keeps between sessions: the queue, where it was, and its settings. */
export interface SavedPlayer {
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
    artist: typeof r.artist === "string" ? r.artist : undefined,
    album: typeof r.album === "string" ? r.album : undefined,
    duration: typeof r.duration === "number" && Number.isFinite(r.duration) ? r.duration : undefined,
  };
};

/** Keeps only what is shaped like saved player state; anything else means "nothing saved". */
export function sanitizePlayer(raw: unknown): SavedPlayer | null {
  const r = raw as Partial<SavedPlayer> | null;
  if (!r || !Array.isArray(r.queue)) return null;
  const queue = r.queue.map(asTrack).filter((t): t is Track => t !== null).slice(0, 2000);
  if (queue.length === 0) return null;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return {
    queue,
    index: Math.round(num(r.index, 0, queue.length - 1, 0)),
    position: num(r.position, 0, 1e7, 0),
    volume: num(r.volume, 0, 1, 1),
    rate: num(r.rate, 0.5, 2, 1),
    repeat: r.repeat === "all" || r.repeat === "one" ? r.repeat : "off",
    shuffle: r.shuffle === true,
  };
}

export async function loadPlayer(): Promise<SavedPlayer | null> {
  try {
    return sanitizePlayer(await (await getStore()).get("player"));
  } catch (e) {
    console.warn("Could not read the player state", e);
    return null;
  }
}

export async function savePlayer(player: SavedPlayer | null) {
  try {
    await (await getStore()).set("player", player);
  } catch (e) {
    console.warn("Could not save the player state", e);
  }
}

export async function loadPlaylists(): Promise<Playlist[]> {
  try {
    return sanitizePlaylists(await (await getStore()).get("playlists"));
  } catch (e) {
    console.warn("Could not read the playlists", e);
    return [];
  }
}

export async function savePlaylists(playlists: Playlist[]) {
  try {
    await (await getStore()).set("playlists", playlists);
  } catch (e) {
    console.warn("Could not save the playlists", e);
  }
}

export async function loadPositions(): Promise<Positions> {
  try {
    return sanitizePositions(await (await getStore()).get("positions"));
  } catch (e) {
    console.warn("Could not read playback positions", e);
    return {};
  }
}

export async function savePositions(positions: Positions) {
  try {
    await (await getStore()).set("positions", positions);
  } catch (e) {
    console.warn("Could not save playback positions", e);
  }
}

export async function loadQueue(): Promise<SavedDownload[]> {
  try {
    return (await (await getStore()).get<SavedDownload[]>("queue")) ?? [];
  } catch (e) {
    console.warn("Could not read the saved queue", e);
    return [];
  }
}

export async function saveQueue(queue: SavedDownload[]) {
  try {
    await (await getStore()).set("queue", queue);
  } catch (e) {
    console.warn("Could not save the queue", e);
  }
}
