import { defaultEqualizer, sanitizeEqualizer, type EqualizerSettings } from "./equalizer";
export interface PlaybackValues {
  rate: number; equalizer: EqualizerSettings; gaplessPlayback: boolean; crossfadeSeconds: number;
  crossfadeCurve: "linear" | "equalPower"; preserveAlbumTransitions: boolean; levelVolume: boolean; resumeLongTracks: boolean;
}
export interface PlaybackProfile extends PlaybackValues { id: string; name: string }
export const defaultPlaybackProfiles = (): PlaybackProfile[] => {
  const music: PlaybackProfile = { id: "music", name: "Music", rate: 1, equalizer: defaultEqualizer(), gaplessPlayback: true, crossfadeSeconds: 0, crossfadeCurve: "equalPower", preserveAlbumTransitions: true, levelVolume: false, resumeLongTracks: true };
  return [music, { ...music, id: "spoken", name: "Spoken audio", rate: 1.25, gaplessPlayback: false, levelVolume: true }, { ...music, id: "practice", name: "Practice", rate: .75, gaplessPlayback: false, resumeLongTracks: false }];
};
export function sanitizePlaybackProfiles(raw: unknown): PlaybackProfile[] {
  if (!Array.isArray(raw)) return defaultPlaybackProfiles();
  const ids = new Set<string>(), names = new Set<string>();
  return raw.slice(0, 20).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const r = value as Partial<PlaybackProfile>;
    if (typeof r.id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(r.id) || ids.has(r.id) || typeof r.name !== "string" || !r.name.trim() || names.has(r.name.trim().toLowerCase())) return [];
    ids.add(r.id); names.add(r.name.trim().toLowerCase());
    return [{ id: r.id, name: r.name.trim().slice(0, 80), rate: typeof r.rate === "number" && Number.isFinite(r.rate) ? Math.max(.5, Math.min(2, r.rate)) : 1,
      equalizer: sanitizeEqualizer(r.equalizer), gaplessPlayback: r.gaplessPlayback !== false,
      crossfadeSeconds: typeof r.crossfadeSeconds === "number" && Number.isFinite(r.crossfadeSeconds) ? Math.max(0, Math.min(12, r.crossfadeSeconds)) : 0,
      crossfadeCurve: r.crossfadeCurve === "equalPower" ? "equalPower" as const : "linear" as const, preserveAlbumTransitions: r.preserveAlbumTransitions !== false, levelVolume: r.levelVolume === true, resumeLongTracks: r.resumeLongTracks !== false }];
  });
}
export const PROFILE_SETTINGS = ["equalizer", "gaplessPlayback", "crossfadeSeconds", "crossfadeCurve", "preserveAlbumTransitions", "levelVolume", "resumeLongTracks"] as const;
