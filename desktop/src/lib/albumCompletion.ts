import type { LibTrack } from "./api";
export interface AlbumRelease { id: string; title: string; artist: string; date: string; country: string; edition: string; status: string; formats: string[]; track_count: number; score: number }
export interface ReleaseTrack { id: string; disc: number; position: number; number: string; title: string; artist: string; duration: number | null }
export interface AlbumTracklist { release: AlbumRelease; tracks: ReleaseTrack[]; complete: boolean }
export type CompletionStatus = "present" | "missing" | "unavailable" | "review" | "conflict";
export interface CompletionRow { expected: ReleaseTrack; status: CompletionStatus; local: LibTrack[]; note: string }
const key = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim();
/** Conservative metadata comparison, never an audio identity claim. One local file fills at most one release slot. */
export function compareAlbum(expected: ReleaseTrack[], local: LibTrack[]) {
  const singleDisc = new Set(expected.map((t) => t.disc)).size === 1;
  const used = new Set<string>();
  const rows: CompletionRow[] = expected.map((track, index) => {
    const sameSlot = (t: LibTrack) => t.track === track.position && (t.disc ?? (singleDisc ? expected[0]?.disc : null)) === track.disc;
    const named = local.filter((t) => !used.has(t.path) && key(t.title) !== "" && key(t.title) === key(track.title));
    const available = named.filter((t) => !t.missing);
    const exact = available.filter(sameSlot);
    const unreserved = available.filter((t) => !expected.some((other, at) => at !== index && key(other.title) === key(t.title) && t.track === other.position && (t.disc ?? (singleDisc ? expected[0]?.disc : null)) === other.disc));
    const candidates = exact.length ? exact : unreserved;
    if (candidates.length) {
      candidates.forEach((t) => used.add(t.path));
      const durationConflict = candidates.some((t) => t.duration > 0 && track.duration != null && Math.abs(t.duration - track.duration) > 5);
      const artistConflict = candidates.some((t) => t.artist.trim() && track.artist.trim() && key(t.artist) !== key(track.artist));
      const notes = [candidates.length > 1 ? "Multiple local copies match" : "", !exact.length ? "Track/disc numbering differs or is missing" : "", durationConflict ? "Duration differs by more than five seconds" : "", artistConflict ? "Artist credit differs" : ""].filter(Boolean);
      return { expected: track, status: notes.length ? "review" : "present", local: candidates, note: notes.join("; ") || "Title and track position match" };
    }
    const unavailable = named.filter((t) => t.missing);
    if (unavailable.length) { unavailable.forEach((t) => used.add(t.path)); return { expected: track, status: "unavailable", local: unavailable, note: "Listed locally, but the file is missing" }; }
    const conflicts = local.filter((t) => !used.has(t.path) && !t.missing && sameSlot(t));
    return { expected: track, status: conflicts.length ? "conflict" : "missing", local: conflicts, note: conflicts.length ? "A different title occupies this track position" : "No matching local title" };
  });
  return { rows, extras: local.filter((t) => !used.has(t.path)) };
}
