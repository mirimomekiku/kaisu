import { expect, it } from "vitest";
import { cleanupReport, metadataIssues } from "./libraryCleanup";
import type { LibTrack } from "./api";
const track = (over: Partial<LibTrack> = {}): LibTrack => ({ path: "/m/a.mp3", title: "Song", artist: "Band", album_artist: "", album: "Record", genre: "Rock", year: 2024, track: null, disc: null, duration: 180, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 10, modified: 1, has_cover: true, loudness: null, ...over });
it("reports metadata gaps without assuming a filename title or unmeasured loudness is bad", () => {
  expect(metadataIssues(track())).toEqual([]);
  expect(metadataIssues(track({ artist: "  ", album: "", genre: "", year: null, has_cover: false, duration: 0 }))).toEqual(["artist", "album", "genre", "year", "artwork", "duration"]);
  expect(metadataIssues(track({ title: "" }))).toEqual(["title"]);
});
it("keeps missing files out of metadata review and counts issues per available file", () => {
  const missing = track({ missing: true, artist: "" });
  const incomplete = track({ path: "/m/b.mp3", artist: "", album: "" });
  const report = cleanupReport([missing, incomplete, track()]);
  expect(report.missing).toEqual([missing]);
  expect(report.metadata).toEqual([{ track: incomplete, issues: ["artist", "album"] }]);
  expect(report.counts.artist).toBe(1);
  expect(report.counts.artwork).toBe(0);
});
