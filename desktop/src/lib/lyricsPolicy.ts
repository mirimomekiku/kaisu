import type { LyricsMode, Preset, SearchSource } from "./api";
export function sourceLyrics(source: SearchSource, preset: Preset, requested?: LyricsMode | null): LyricsMode {
  if (preset !== "audio") return "off";
  return source === "youtube_music" ? "both" : requested ?? "off";
}
