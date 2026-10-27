import type { LibTrack, SongLyrics } from "./api";

/** One run's limit; each lookup is a request to a free service. */
export const MAX_LYRICS_RUN = 200;
export const LYRICS_PAUSE_MS = 250;

export type LyricsOutcome = "timed" | "plain" | "has" | "none" | "failed";

/** What a failed lookup means for the run: nothing found for that song, a service problem that will repeat, or one song's trouble. */
export function lyricsFailure(message: string): "none" | "stop" | "failed" {
  if (/^No lyrics were found/i.test(message)) return "none";
  if (/reach the lyrics service|answered (429|5\d\d)|too many/i.test(message)) return "stop";
  return "failed";
}

export function lyricsOutcome(found: SongLyrics): LyricsOutcome { return found.synced ? "timed" : "plain"; }

export interface LyricsTally { timed: number; plain: number; has: number; none: number; failed: number }
export const emptyTally = (): LyricsTally => ({ timed: 0, plain: 0, has: 0, none: 0, failed: 0 });

export function lyricsTargets(tracks: LibTrack[]): LibTrack[] {
  return tracks.filter((t) => !t.missing).slice(0, MAX_LYRICS_RUN);
}
