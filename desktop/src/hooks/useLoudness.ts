import { useEffect, useMemo } from "react";
import type { PlayerEngine } from "../lib/audioEngine";
import type { LibTrack } from "../lib/api";
import { levelGain } from "../lib/loudness";
import { usePlayerState } from "./usePlayer";

interface Args {
  engine: PlayerEngine;
  enabled: boolean;
  tracks: LibTrack[];
  /** Measures a song that hasn't been yet. */
  measure: (paths: string[]) => Promise<void>;
}

/**
 * Keeps the player's volume level for the song it is on: loud songs are turned down by how much louder than the target they
 * were measured. A song not yet measured plays as it is while it is measured in the background.
 */
export function useLoudness({ engine, enabled, tracks, measure }: Args) {
  const { queue, index } = usePlayerState(engine);
  const path = queue[index]?.path ?? null;
  const byPath = useMemo(() => new Map(tracks.map((t) => [t.path, t])), [tracks]);
  const known = path ? byPath.get(path) : undefined;
  const loudness = known?.loudness ?? null;

  useEffect(() => { engine.setLevelMap(new Map(tracks.map((t) => [t.path, levelGain(t.loudness, enabled)]))); }, [engine, tracks, enabled]);

  useEffect(() => {
    engine.setLevelGain(levelGain(loudness, enabled));
  }, [engine, enabled, loudness, path]);

  useEffect(() => {
    if (enabled && path && known && loudness == null) void measure([path]).catch(() => {});
  }, [enabled, path, known, loudness, measure]);
}
