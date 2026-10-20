import { load, type Store } from "@tauri-apps/plugin-store";
import type { AudioFormat, Browser, CloseMode, ExtraOptions, Layout, NameStyle, Preset, SponsorBlock } from "./api";

export type Mode = "simple" | "advanced";

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
  subtitles: boolean;
  audioFormat: AudioFormat;
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
  subtitles: false,
  audioFormat: "mp3",
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
}

const MAX_HISTORY = 500;
let storePromise: Promise<Store> | null = null;

const getStore = () => (storePromise ??= load("kaisu.json", { defaults: {}, autoSave: 200 }));

export async function loadSettings(): Promise<Settings> {
  try {
    const saved = await (await getStore()).get<Partial<Settings>>("settings");
    return { ...DEFAULT_SETTINGS, ...saved };
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
