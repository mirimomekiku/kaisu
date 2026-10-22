import { describe, expect, it } from "vitest";
import { relocatePreference, sanitizeMusicPreferences, setPreference } from "./musicPreferences";
import { mergeListening, recordListeningTime, sanitizeListening } from "./listening";
import { listeningSummary } from "./listeningDashboard";
import { blankSmartRule, sanitizeSmart, smartTracks } from "./smartPlaylists";
import type { LibTrack } from "./api";
const a = { path: "/a.mp3", title: "A", artist: "Band", missing: false } as LibTrack;
const b = { path: "/b.mp3", title: "B", artist: "Band", missing: false } as LibTrack;
describe("favorites and ratings", () => {
  it("keeps valid preferences and rejects invalid ratings", () => {
    expect(sanitizeMusicPreferences({ a: { favorite: true, rating: 5 }, b: { favorite: "true", rating: 9 }, c: { rating: 3.2 }, d: null })).toEqual({ a: { favorite: true, rating: 5 } });
    expect(sanitizeMusicPreferences([])).toEqual({});
  });
  it("updates immutably and removes empty preferences", () => {
    const all = { a: { favorite: true, rating: 4 } };
    expect(setPreference(all, "a", { favorite: false })).toEqual({ a: { favorite: false, rating: 4 } });
    expect(setPreference(all, "a", { favorite: false, rating: 0 })).toEqual({});
    expect(all.a.favorite).toBe(true);
  });
  it("merges relocated files without losing a favorite or a higher rating", () => {
    const all = { a: { favorite: true, rating: 3 }, b: { favorite: false, rating: 5 } };
    expect(relocatePreference(all, "a", "b")).toEqual({ b: { favorite: true, rating: 5 } });
    expect(relocatePreference(all, "a", "a")).toBe(all);
  });
  it("supports favorite and rating smart rules, including unrated zero", () => {
    const smart = { match: "all" as const, rules: [{ ...blankSmartRule("favorite"), value: "yes" }, { ...blankSmartRule("rating"), op: "at_least", value: "4" }] };
    expect(smartTracks([a, b], smart, {}, 0, { [a.path]: { favorite: true, rating: 5 } })).toEqual([a]);
    expect(smartTracks([a, b], { match: "all", rules: [{ field: "rating", op: "is", value: "0" }] }, {})).toEqual([a, b]);
    expect(sanitizeSmart({ match: "all", rules: [{ field: "rating", op: "is", value: "6" }] })).toBeUndefined();
  });
});
describe("listening dashboard data", () => {
  it("retains legacy counts without inventing listening time", () => {
    const legacy = sanitizeListening({ [a.path]: { plays: 4, lastPlayed: 100 } });
    const s = listeningSummary([a], legacy);
    expect(s.plays).toBe(4); expect(s.seconds).toBe(0); expect(s.artists[0].plays).toBe(4);
  });
  it("records partial listening independently from completed plays and preserves metadata", () => {
    const stats = recordListeningTime({}, a, 2.5, 100);
    expect(stats[a.path]).toMatchObject({ plays: 0, seconds: 2.5, title: "A", artist: "Band", lastListened: 100 });
    expect(recordListeningTime(stats, a, NaN)).toBe(stats);
    expect(sanitizeListening(stats)).toEqual(stats);
  });
  it("ranks songs and artists and keeps unavailable tracks in historical totals", () => {
    const s = listeningSummary([a], { [a.path]: { plays: 2, lastPlayed: 100, seconds: 30 }, [b.path]: { plays: 3, lastPlayed: 50, seconds: 40, title: "B", artist: "Band", lastListened: 200 } });
    expect(s.recent[0].title).toBe("B"); expect(s.top[0].path).toBe(b.path); expect(s.top[0].track).toBeUndefined();
    expect(s.plays).toBe(5); expect(s.seconds).toBe(70); expect(s.unique).toBe(2); expect(s.artists).toEqual([{ name: "Band", plays: 5, seconds: 70 }]);
  });
  it("merges counts, measured time and latest timestamps on load or relocation", () => {
    expect(mergeListening({ plays: 2, lastPlayed: 20, seconds: 5, lastListened: 30 }, { plays: 1, lastPlayed: 10, seconds: 3, lastListened: 40 })).toMatchObject({ plays: 3, lastPlayed: 20, seconds: 8, lastListened: 40 });
  });
});
