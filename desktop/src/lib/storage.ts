import { load, type Store } from "@tauri-apps/plugin-store";
import type { AudioFormat, Browser, CloseMode, CoverMode, ExtraOptions, Layout, LyricsMode, NameStyle, Preset, SearchSource, SponsorBlock } from "./api";
import { sanitizePresets, type FormatPreset } from "./presets";
import type { HistorySort } from "./history";
import type { ScheduleRule } from "./schedule";

export type Mode = "simple" | "advanced";
export type SubtitleMode = "off" | "embed" | "file" | "both";
export type Theme = "system" | "aqua" | "graphite" | "dark";
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
  rateLimit: string;
  customArgs: string;
  verbose: boolean;
  // File organisation (both modes).
  layout: Layout;
  nameStyle: NameStyle;
  customName: string;
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
  // Network and searching.
  searchSource: SearchSource;
  proxy: string;
  schedule: ScheduleRule[];
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
  rateLimit: "",
  customArgs: "",
  verbose: true,
  layout: "flat",
  nameStyle: "title_id",
  customName: "",
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
  searchSource: "youtube",
  proxy: "",
  schedule: [],
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
    // Before language choice existed there was one on/off switch for English subtitles.
    if (saved?.subtitles === true && saved.subtitleMode === undefined) merged.subtitleMode = "embed";
    return merged;
  } catch (e) {
    console.warn("Could not read settings", e);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings) {
  try {
    await (await getStore()).set("settings", settings);
  } catch (e) {
    console.warn("Could not save settings", e);
  }
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
