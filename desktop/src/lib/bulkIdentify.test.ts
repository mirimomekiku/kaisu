import { describe, expect, it } from "vitest";
import type { LibTrack } from "./api";
import { chooseMatch, estimateSeconds, MAX_BULK, proposedEdit } from "./bulkIdentify";
import type { IdentificationCandidate } from "./identification";

const rel = (id: string, title = "Album") => ({ id, title, date: "2001", country: "US", edition: "" });
const cand = (over: Partial<IdentificationCandidate>): IdentificationCandidate => ({ id: "r1", title: "Song", artist: "Band", duration: 200, score: 100, releases: [rel("a")], ...over });
const track = { duration: 201, album: "", artist: "Band" };

describe("chooseMatch", () => {
  it("is confident only with a high score, a close length and the same artist", () => {
    expect(chooseMatch([cand({})], track)?.confidence).toBe("high");
    expect(chooseMatch([cand({ score: 80 })], track)?.confidence).toBe("review");
    expect(chooseMatch([cand({ duration: 260 })], track)?.confidence).toBe("review");
    expect(chooseMatch([cand({ artist: "Someone Else" })], track)?.confidence).toBe("review");
    expect(chooseMatch([cand({ releases: [] })], track)).toMatchObject({ confidence: "review", releaseId: null });
  });
  it("accepts an untagged artist and unknown lengths", () => {
    expect(chooseMatch([cand({ duration: null })], { duration: 0, album: "", artist: "" })?.confidence).toBe("high");
  });
  it("prefers the higher score, then the closer length", () => {
    const best = chooseMatch([cand({ id: "low", score: 90 }), cand({ id: "far", duration: 190 }), cand({ id: "near", duration: 201 })], track);
    expect(best?.candidate.id).toBe("near");
  });
  it("keeps one release across an album, then the song's own album, then the first", () => {
    const releases = [rel("a", "Greatest Hits"), rel("b", "Real Album"), rel("c", "Deluxe")];
    expect(chooseMatch([cand({ releases })], track, new Set(["c"]))?.releaseId).toBe("c");
    expect(chooseMatch([cand({ releases })], { ...track, album: "real album!" })?.releaseId).toBe("b");
    expect(chooseMatch([cand({ releases })], track)?.releaseId).toBe("a");
  });
  it("returns nothing when there are no candidates", () => expect(chooseMatch([], track)).toBeNull());
});

describe("proposedEdit", () => {
  const song = { title: "song", artist: "Band", album: "", album_artist: "", genre: "", track: null, disc: null, year: null } as unknown as LibTrack;
  it("lists only the fields that differ", () => {
    expect(proposedEdit(song, { title: "Song", artist: "Band", album: "Album", year: "2001", track: "3" })).toEqual({ title: "Song", album: "Album", year: "2001", track: "3" });
    expect(proposedEdit(song, { title: "song", artist: "Band" })).toEqual({});
  });
});

describe("limits", () => {
  it("estimates time and caps a run", () => {
    expect(estimateSeconds(10)).toBe(33);
    expect(estimateSeconds(MAX_BULK + 50)).toBe(estimateSeconds(MAX_BULK));
  });
});
