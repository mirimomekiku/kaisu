import { Channel, invoke } from "@tauri-apps/api/core";

export type Preset = "best" | "p1080" | "p720" | "audio";
export type AudioFormat = "mp3" | "m4a" | "opus" | "flac" | "wav";
export type SponsorBlock = "off" | "mark" | "remove";
export type Browser = "firefox" | "chrome" | "chromium" | "edge" | "brave" | "opera" | "vivaldi";

export interface ExtraOptions {
  sponsorblock: SponsorBlock;
  cookies_from_browser: Browser | null;
  subtitles: boolean;
  audio_format: AudioFormat;
  /** A specific yt-dlp format id (or `video+audio`); null lets the preset decide. */
  format_id: string | null;
  rate_limit: string | null;
  custom_args: string | null;
  verbose: boolean;
}

export interface DownloadRequest {
  id: string;
  url: string;
  preset: Preset;
  out_dir: string;
  extra: ExtraOptions;
}

export type DownloadEvent =
  | { kind: "progress"; pct: number; speed: number | null; eta: number | null }
  | { kind: "processing" }
  | { kind: "log"; line: string }
  | { kind: "done"; path: string | null }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface FormatInfo {
  id: string;
  ext: string;
  resolution: string | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
  note: string | null;
  /** "video" = no audio track, "audio" = no video track, "both" = muxed. */
  kind: "video" | "audio" | "both";
}

export interface MediaInfo {
  title: string;
  thumbnail: string | null;
  uploader: string | null;
  duration_secs: number | null;
  view_count: number | null;
  formats: FormatInfo[];
}

export type ComponentId = "ytdlp" | "ffmpeg" | "js";

export interface Component {
  ready: boolean;
  source: "bundled" | "managed" | "system" | null;
  version: string | null;
  path: string | null;
}

export interface EngineInfo {
  ytdlp: Component;
  ffmpeg: Component;
  js: Component;
  ready: boolean;
}

export interface Platform {
  os: string;
  arch: string;
  distro: string | null;
  auto_install: boolean;
}

export interface SetupInfo {
  engine: EngineInfo;
  platform: Platform;
  manual_steps: string[];
  managed_dir: string;
}

export type SetupEvent =
  | { kind: "step"; component: ComponentId; label: string }
  | { kind: "progress"; component: ComponentId; pct: number }
  | { kind: "finished" };

export interface UpdateResult {
  updated: boolean;
  version: string;
  previous: string;
}

export const errorText = (e: unknown): string =>
  typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong";

export const getMediaInfo = (url: string, cookiesFromBrowser: Browser | null) =>
  invoke<MediaInfo>("get_media_info", { url, cookiesFromBrowser });

export const getEngineInfo = () => invoke<EngineInfo>("get_engine_info");
export const updateEngine = () => invoke<UpdateResult>("update_engine");
export const defaultDownloadDir = () => invoke<string>("default_download_dir");
export const cancelDownload = (id: string) => invoke<void>("cancel_download", { id });

/** Starts a download; resolves when yt-dlp exits. Progress arrives through `onEvent`. */
export function startDownload(req: DownloadRequest, onEvent: (e: DownloadEvent) => void) {
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("start_download", { req, onEvent: channel });
}

export const checkSetup = () => invoke<SetupInfo>("check_setup");

/** Installs whatever is missing; resolves with the refreshed engine state. */
export function runSetup(onEvent: (e: SetupEvent) => void) {
  const channel = new Channel<SetupEvent>();
  channel.onmessage = onEvent;
  return invoke<EngineInfo>("run_setup", { onEvent: channel });
}
