import type { CoverMode, LyricsMode } from "./api";
import type { SubtitleMode } from "./storage";

/** A named set of download choices that can be applied in one click. */
export interface FormatPreset {
  id: string;
  name: string;
  kind: "video" | "audio";
  quality: "best" | "p1080" | "p720";
  subMode: SubtitleMode;
  subLangs: string;
  audioQuality: string;
  normalize: boolean;
  trimSilence: boolean;
  cover: Exclude<CoverMode, "custom">;
  lyrics: LyricsMode;
}

export const MAX_PRESETS = 20;
export const MAX_PRESET_NAME = 40;

export const presetId = () => `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Why a preset name can't be used, or null. */
export function checkPresetName(name: string, existing: FormatPreset[]): string | null {
  const clean = name.trim();
  if (!clean) return "Give the preset a name.";
  if (clean.length > MAX_PRESET_NAME) return `Names can be up to ${MAX_PRESET_NAME} characters.`;
  if (existing.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return "A preset with that name already exists.";
  if (existing.length >= MAX_PRESETS) return `You can keep up to ${MAX_PRESETS} presets.`;
  return null;
}

/** Keeps saved presets that still make sense (settings files can be edited or come from another version). */
export function sanitizePresets(value: unknown): FormatPreset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is FormatPreset => !!p && typeof p === "object" && typeof (p as FormatPreset).id === "string" && typeof (p as FormatPreset).name === "string")
    .slice(0, MAX_PRESETS)
    .map((p) => ({
      id: p.id,
      name: p.name.trim().slice(0, MAX_PRESET_NAME) || "Preset",
      kind: p.kind === "audio" ? "audio" : "video",
      quality: p.quality === "p1080" || p.quality === "p720" ? p.quality : "best",
      subMode: (["off", "embed", "file", "both"] as const).includes(p.subMode) ? p.subMode : "off",
      subLangs: typeof p.subLangs === "string" ? p.subLangs.slice(0, 100) : "en",
      audioQuality: typeof p.audioQuality === "string" ? p.audioQuality : "",
      normalize: !!p.normalize,
      trimSilence: !!p.trimSilence,
      cover: p.cover === "square" || p.cover === "none" ? p.cover : "default",
      lyrics: (["off", "file", "embed", "both"] as const).includes(p.lyrics) ? p.lyrics : "off",
    }));
}
