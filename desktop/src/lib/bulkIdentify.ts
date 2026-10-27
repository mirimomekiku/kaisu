import type { LibTrack } from "./api";
import { identificationEdit, type IdentificationCandidate, type SuggestedTags } from "./identification";
import { FIELDS, startForm, type TagEditRequest } from "./tagEdit";

/** Each song costs about three MusicBrainz requests at one per second, so one run is limited. */
export const MAX_BULK = 100;
export const SECONDS_PER_SONG = 3.3;
/** A score this high, with a matching length, is applied by default; anything else waits for the user to tick it. */
const CONFIDENT_SCORE = 95;
const DURATION_SLACK = 5;

export type Confidence = "high" | "review";
export interface Match { candidate: IdentificationCandidate; releaseId: string | null; confidence: Confidence }

const plain = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const gap = (c: IdentificationCandidate, duration: number) => (c.duration == null || duration <= 0 ? 0 : Math.abs(c.duration - duration));

/**
 * The best recording for a song: the highest score, then the closest length. The release is the one already chosen for
 * another song of the same album when it is offered, otherwise one that matches the song's own album, otherwise the first.
 */
export function chooseMatch(candidates: IdentificationCandidate[], track: Pick<LibTrack, "duration" | "album" | "artist">, preferred: ReadonlySet<string> = new Set()): Match | null {
  const ranked = [...candidates].sort((a, b) => b.score - a.score || gap(a, track.duration) - gap(b, track.duration));
  const candidate = ranked[0];
  if (!candidate) return null;
  const releases = candidate.releases;
  const release = releases.find((r) => preferred.has(r.id)) ?? releases.find((r) => track.album && plain(r.title) === plain(track.album)) ?? releases[0];
  const sameArtist = !track.artist.trim() || plain(candidate.artist).includes(plain(track.artist)) || plain(track.artist).includes(plain(candidate.artist));
  const confident = candidate.score >= CONFIDENT_SCORE && gap(candidate, track.duration) <= DURATION_SLACK && sameArtist && !!release;
  return { candidate, releaseId: release?.id ?? null, confidence: confident ? "high" : "review" };
}

/** What would change in this song's tags. Empty when the suggestion adds nothing. */
export function proposedEdit(track: LibTrack, tags: SuggestedTags): TagEditRequest {
  return identificationEdit(startForm([track]).values, tags, new Set(FIELDS));
}

export function estimateSeconds(count: number): number { return Math.round(Math.min(count, MAX_BULK) * SECONDS_PER_SONG); }
