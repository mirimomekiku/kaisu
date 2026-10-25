import type { LibTrack } from "./api";

export const METADATA_ISSUES = ["title", "artist", "album", "genre", "year", "artwork", "duration"] as const;
export type MetadataIssue = typeof METADATA_ISSUES[number];
export const ISSUE_LABELS: Record<MetadataIssue, string> = {
  title: "Missing title", artist: "Missing artist", album: "Missing album", genre: "Missing genre",
  year: "Missing year", artwork: "No embedded artwork", duration: "Duration unavailable",
};

/** Report only what the scanner knows; a filename-derived title cannot prove a missing title tag. */
export function metadataIssues(track: LibTrack): MetadataIssue[] {
  if (track.missing) return [];
  return METADATA_ISSUES.filter((issue) => {
    switch (issue) {
      case "artwork": return !track.has_cover;
      case "year": return !track.year;
      case "duration": return !(track.duration > 0);
      default: return !track[issue].trim();
    }
  });
}

/**
 * The scanner still lists a file whose properties could not be read (named after the file). Such a file has no duration, sample
 * rate, channels or bitrate; an empty file has no size. Neither can be played, so they are reported apart from tag gaps.
 */
export function isUnreadable(track: LibTrack): boolean {
  if (track.missing) return false;
  return track.size === 0 || (!(track.duration > 0) && track.sample_rate == null && track.channels == null && track.bitrate == null);
}

export function cleanupReport(tracks: LibTrack[]) {
  const missing: LibTrack[] = [];
  const unreadable: LibTrack[] = [];
  const metadata: Array<{ track: LibTrack; issues: MetadataIssue[] }> = [];
  const counts = Object.fromEntries(METADATA_ISSUES.map((key) => [key, 0])) as Record<MetadataIssue, number>;
  for (const track of tracks) {
    if (track.missing) { missing.push(track); continue; }
    if (isUnreadable(track)) { unreadable.push(track); continue; }
    const issues = metadataIssues(track);
    if (issues.length) metadata.push({ track, issues });
    for (const issue of issues) counts[issue]++;
  }
  return { missing, unreadable, metadata, counts };
}
