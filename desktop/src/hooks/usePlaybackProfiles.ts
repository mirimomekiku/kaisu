import { useCallback, useEffect, useRef } from "react";
import type { PlayerEngine } from "../lib/audioEngine";
import type { Settings } from "../lib/storage";
import { defaultPlaybackProfiles, type PlaybackValues } from "../lib/playbackProfiles";

export function usePlaybackProfiles(engine: PlayerEngine, settings: Settings, ready: boolean, change: (patch: Partial<Settings>) => void) {
  const current = useRef(settings); current.current = settings;
  const initialized = useRef(false);
  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    const profile = settings.playbackProfiles.find((p) => p.id === settings.activePlaybackProfile);
    if (profile) engine.setRate(profile.rate);
  }, [ready, settings, engine]);
  useEffect(() => { const off = engine.subscribe(() => {
    if (!ready || !initialized.current) return;
    const profile = current.current.playbackProfiles.find((p) => p.id === current.current.activePlaybackProfile);
    if (profile && Math.abs(profile.rate - engine.getState().rate) > .001) change({ activePlaybackProfile: "" });
  }); return () => { off(); }; }, [engine, ready, change]);
  const apply = useCallback((id: string) => {
    const profile = current.current.playbackProfiles.find((p) => p.id === id);
    if (!profile) { change({ activePlaybackProfile: "" }); return; }
    const { name: _name, id: _id, rate, ...values } = profile;
    current.current = { ...current.current, ...values, activePlaybackProfile: id };
    change({ ...values, activePlaybackProfile: id });
    engine.setRate(rate);
  }, [engine, change]);
  const save = useCallback((name: string, id?: string): string | null => {
    const s = current.current;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) return "Use a profile name between 1 and 80 characters.";
    if (s.playbackProfiles.some((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) return "That profile name is already used.";
    if (!id && s.playbackProfiles.length >= 20) return "You can save up to 20 playback profiles.";
    const values: PlaybackValues = { rate: engine.getState().rate, equalizer: structuredClone(s.equalizer), gaplessPlayback: s.gaplessPlayback, crossfadeSeconds: s.crossfadeSeconds, crossfadeCurve: s.crossfadeCurve, preserveAlbumTransitions: s.preserveAlbumTransitions, levelVolume: s.levelVolume, resumeLongTracks: s.resumeLongTracks };
    const profile = { ...values, id: id ?? crypto.randomUUID(), name: trimmed };
    change({ playbackProfiles: id ? s.playbackProfiles.map((p) => p.id === id ? profile : p) : [...s.playbackProfiles, profile], activePlaybackProfile: profile.id });
    return null;
  }, [engine, change]);
  const remove = useCallback((id: string) => change({ playbackProfiles: current.current.playbackProfiles.filter((p) => p.id !== id), activePlaybackProfile: current.current.activePlaybackProfile === id ? "" : current.current.activePlaybackProfile }), [change]);
  const reset = useCallback(() => change({ playbackProfiles: defaultPlaybackProfiles(), activePlaybackProfile: "" }), [change]);
  return { profiles: settings.playbackProfiles, active: settings.activePlaybackProfile, apply, save, remove, reset };
}
export type PlaybackProfilesApi = ReturnType<typeof usePlaybackProfiles>;
