import type { AudioExtras, Clip, CoverOptions, ExtraOptions, LyricsMode, MetaOptions, OutputOptions, PlaylistCtx, SubtitleOptions } from "./api";
import { parseLangs, toOptions } from "./subtitles";
import type { Settings } from "./storage";

// Turning the user's settings (and what they chose for one download) into the options sent with a download request.

/** What Simple mode always sends: sensible defaults, none of the advanced settings. */
export const SIMPLE_BASE: Omit<ExtraOptions, "output" | "playlist" | "clip" | "proxy" | "subs" | "meta" | "cover" | "lyrics" | "audio" | "clean_titles"> = {
  sponsorblock: "off",
  cookies_from_browser: null,
  audio_format: "mp3",
  format_id: null,
  rate_limit: null,
  custom_args: null,
  verbose: false,
};

/** Choices made for one download, which win over the settings. */
export interface ExtraContext {
  playlist?: PlaylistCtx | null;
  clip?: Clip | null;
  subs?: SubtitleOptions | null;
  meta?: MetaOptions | null;
  cover?: CoverOptions | null;
  lyrics?: LyricsMode | null;
  audio?: AudioExtras | null;
  /** Replaces the audio format from the settings (a site rule can ask for one). */
  audioFormat?: ExtraOptions["audio_format"];
  /** Replaces the speed limit from the settings (a single download can be slowed on its own). */
  rateLimit?: string | null;
}

export const isAdvanced = (settings: Settings) => settings.mode === "advanced";

export const outputOptions = (settings: Settings): OutputOptions => ({
  layout: settings.layout,
  name: settings.nameStyle,
  custom: isAdvanced(settings) && settings.customName.trim() ? settings.customName.trim() : null,
  playlist_folder: settings.playlistFolder,
  playlist_numbering: settings.playlistNumbering,
});

export const defaultSubs = (settings: Settings): SubtitleOptions | null =>
  isAdvanced(settings) ? toOptions(settings.subtitleMode, parseLangs(settings.subtitleLangs), settings.subtitleAuto) : null;

export const defaultAudio = (settings: Settings): AudioExtras | null =>
  isAdvanced(settings) ? { quality: settings.audioQuality.trim() || null, normalize: settings.audioNormalize, trim_silence: settings.audioTrimSilence } : null;

/** The options for one download: the settings for the current mode, with this download's own choices on top. */
export function buildExtra(settings: Settings, formatId: string | null, ctx?: ExtraContext): ExtraOptions {
  const advanced = isAdvanced(settings);
  const base = advanced
    ? {
        sponsorblock: settings.sponsorblock,
        cookies_from_browser: settings.cookiesBrowser,
        audio_format: settings.audioFormat,
        format_id: formatId,
        rate_limit: settings.rateLimit.trim() || null,
        custom_args: settings.customArgs.trim() || null,
        verbose: settings.verbose,
      }
    : SIMPLE_BASE;
  return {
    collision: settings.downloadConflict ?? "keep_both",
    meta: ctx?.meta ?? null,
    cover: ctx?.cover !== undefined ? ctx.cover : advanced ? { mode: settings.coverMode } : null,
    lyrics: ctx?.lyrics !== undefined ? ctx.lyrics : advanced ? settings.lyricsMode : null,
    audio: ctx?.audio !== undefined ? ctx.audio : defaultAudio(settings),
    // The proxy applies in both modes: it is about reaching the internet, not about choices.
    proxy: settings.proxy.trim() || null,
    clean_titles: settings.cleanTitles,
    subs: ctx?.subs !== undefined ? ctx.subs : defaultSubs(settings),
    ...base,
    audio_format: ctx?.audioFormat ?? base.audio_format,
    rate_limit: ctx?.rateLimit !== undefined ? ctx.rateLimit : base.rate_limit,
    output: outputOptions(settings),
    playlist: ctx?.playlist ?? null,
    clip: ctx?.clip ?? null,
  };
}

/** Short descriptions of the advanced options that will apply, for the video card. */
export const activeOptions = (settings: Settings): string[] =>
  [
    settings.sponsorblock !== "off" && `SponsorBlock ${settings.sponsorblock}`,
    settings.cookiesBrowser && `cookies from ${settings.cookiesBrowser}`,
    settings.subtitleMode !== "off" && `subtitles (${settings.subtitleLangs.trim() || "none chosen"})`,
    settings.proxy.trim() && "proxy",
    settings.rateLimit.trim() && `limit ${settings.rateLimit.trim()}/s`,
    settings.customArgs.trim() && "custom arguments",
    settings.audioFormat !== "mp3" && `audio ${settings.audioFormat.toUpperCase()}`,
  ].filter((x): x is string => Boolean(x));
