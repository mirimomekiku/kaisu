import { expect, it } from "vitest";
import { compareAlbum, type ReleaseTrack } from "./albumCompletion";
import type { LibTrack } from "./api";
const expected = (title: string, position: number, disc = 1): ReleaseTrack => ({ id: `${disc}-${position}`, disc, position, number: String(position), title, artist: "Artist", duration: 180 });
const local = (title: string, track: number | null, extras: Partial<LibTrack> = {}): LibTrack => ({ path: `/${title}-${track}.mp3`, title, track, disc: 1, artist: "Artist", duration: 180, ...extras } as LibTrack);
it("distinguishes present, missing, unavailable and conflicting tracks", () => {
  const result = compareAlbum([expected("One", 1), expected("Two", 2), expected("Three", 3), expected("Four", 4)], [local("One", 1), local("Three", 3, { missing: true }), local("Other edition", 4)]);
  expect(result.rows.map((r) => r.status)).toEqual(["present", "missing", "unavailable", "conflict"]);
  expect(result.extras.map((t) => t.title)).toEqual(["Other edition"]);
});
it("keeps alternate versions and uncertain metadata visible for review", () => {
  const result = compareAlbum([expected("Song", 1), expected("Song (Live)", 2), expected("Another", 3)], [local("Song", null), local("Song Live", 2, { duration: 205 }), local("Another", 3, { artist: "Guest" })]);
  expect(result.rows.map((r) => r.status)).toEqual(["review", "review", "review"]);
  expect(result.rows[1].note).toContain("Duration");
});
it("does not consume a repeated title that belongs to another disc or track slot", () => {
  const result = compareAlbum([expected("Intro", 1, 1), expected("Intro", 1, 2)], [local("Intro", 1, { disc: 2 })]);
  expect(result.rows.map((r) => r.status)).toEqual(["missing", "present"]);
});
it("never uses one file twice and asks for review when duplicate copies exist", () => {
  const result = compareAlbum([expected("Song", 1), expected("Song", 2)], [local("Song", 1), local("Song", 1, { path: "/copy.flac" })]);
  expect(result.rows.map((r) => r.status)).toEqual(["review", "missing"]);
  expect(result.rows[0].note).toContain("Multiple");
});
