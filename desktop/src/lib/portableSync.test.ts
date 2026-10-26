import { describe, expect, it } from "vitest";
import { portableSelection } from "./portableSync";
import type { LibTrack } from "./api";
import type { Playlist } from "./playlists";
const tracks = [
  { path: "/a.flac", title: "A", artist: "Artist", album: "Album", track: 1, disc: 1, duration: 10, format: "FLAC", missing: false },
  { path: "/b.mp3", title: "B", artist: "Artist", album: "Album", track: 2, disc: 1, duration: 10, format: "MP3", missing: false },
  { path: "/gone.mp3", title: "Gone", artist: "Artist", album: "Album", track: 3, missing: true },
] as LibTrack[];
describe("portable collection selection", () => {
  it("excludes missing songs, deduplicates physical copies, and preserves playlist order and repeats", () => {
    const playlists = [{ id: "p", name: "Ordered", updated: 0, paths: ["/b.mp3", "/a.flac", "/b.mp3", "/gone.mp3", "/unknown.mp3"] }] as Playlist[];
    const selection = portableSelection({ source_kind: "playlists", source_ids: ["p"] }, tracks, playlists, {}, {});
    expect(selection.paths).toEqual(["/b.mp3", "/a.flac"]);
    expect(selection.playlists[0].paths).toEqual(["/b.mp3", "/a.flac", "/b.mp3"]);
    expect(playlists[0].paths).toHaveLength(5);
  });
  it("evaluates smart playlists from current preferences", () => {
    const playlists = [{ id: "smart", name: "Favorites", updated: 0, paths: [], smart: { match: "all", rules: [{ field: "favorite", op: "is", value: "yes" }] } }] as Playlist[];
    expect(portableSelection({ source_kind: "playlists", source_ids: ["smart"] }, tracks, playlists, {}, { "/a.flac": { favorite: true, rating: 4 } }).paths).toEqual(["/a.flac"]);
    expect(portableSelection({ source_kind: "playlists", source_ids: ["missing"] }, tracks, playlists, {}, {}).paths).toEqual([]);
  });
  it("whole-library sync includes only available songs", () => {
    expect(portableSelection({ source_kind: "library", source_ids: [] }, tracks, [], {}, {}).paths).toEqual(["/a.flac", "/b.mp3"]);
  });
});
