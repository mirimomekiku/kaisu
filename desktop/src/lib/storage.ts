import { load, type Store } from "@tauri-apps/plugin-store";
import type { AudioFormat, Browser, Preset, SponsorBlock } from "./api";

export type Mode = "simple" | "advanced";

export interface Settings {
  mode: Mode;
  outDir: string | null;
  autoUpdate: boolean;
  lastEngineCheck: number;
  // Advanced-only options (ignored in simple mode).
  concurrency: number;
  sponsorblock: SponsorBlock;
  cookiesBrowser: Browser | null;
  subtitles: boolean;
  audioFormat: AudioFormat;
  rateLimit: string;
  customArgs: string;
  verbose: boolean;
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  preset: Preset;
  path: string | null;
  timestamp: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "simple",
  outDir: null,
  autoUpdate: true,
  lastEngineCheck: 0,
  concurrency: 2,
  sponsorblock: "off",
  cookiesBrowser: null,
  subtitles: false,
  audioFormat: "mp3",
  rateLimit: "",
  customArgs: "",
  verbose: true,
};

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
