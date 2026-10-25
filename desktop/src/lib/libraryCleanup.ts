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

export function cleanupReport(tracks: LibTrack[]) {
  const missing: LibTrack[] = [];
  const metadata: Array<{ track: LibTrack; issues: MetadataIssue[] }> = [];
  const counts = Object.fromEntries(METADATA_ISSUES.map((key) => [key, 0])) as Record<MetadataIssue, number>;
  for (const track of tracks) {
    if (track.missing) { missing.push(track); continue; }
    const issues = metadataIssues(track);
    if (issues.length) metadata.push({ track, issues });
    for (const issue of issues) counts[issue]++;
  }
  return { missing, metadata, counts };
}
