import { describe, expect, it } from "vitest";
import type { LibTrack } from "./api";
import { blankSmartRule, sanitizeSmart, smartProblem, smartTracks, type SmartRules } from "./smartPlaylists";
import { recordPlayed, sanitizeListening } from "./listening";
import { addPaths, createPlaylist, moveTrack, removeAt, sanitizePlaylists, toM3u } from "./playlists";
const t = (title: string, over: Partial<LibTrack> = {}): LibTrack => ({ path: `/m/${title}.mp3`, title, artist: "Beyonc\u00e9", album_artist: "", album: "Album", genre: "Pop", year: 2020, track: null, disc: null, duration: 180, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 10, modified: 1, has_cover: false, loudness: null, ...over });
const rule = (field: Parameters<typeof blankSmartRule>[0], value: string, op?: string): SmartRules => ({ match: "all", rules: [{ ...blankSmartRule(field), value, ...(op ? { op } : {}) }] });
const a = t("A"), b = t("B", { artist: "Other", year: null }), missing = t("C", { missing: true });
describe("smart playlists", () => {
  it("combines all/any rules and normalizes accents and capitals", () => {
    const smart: SmartRules = { match: "all", rules: [...rule("artist", "BEYONCE").rules, ...rule("year", "2020", "is").rules] };
    expect(smartTracks([b, missing, a], smart, {})).toEqual([a]);
    expect(smartTracks([b, a], { ...smart, match: "any", rules: [...smart.rules, ...rule("title", "B", "is").rules] }, {})).toEqual([a, b]);
  });
  it("does not match unknown years as zero", () => expect(smartTracks([b], rule("year", "0", "at_most"), {})).toEqual([]));
  it("updates unplayed and count rules when a song finishes", () => {
    const stats = recordPlayed({}, a.path, 123);
    expect(smartTracks([a, b], rule("played", "never"), stats)).toEqual([b]);
    expect(smartTracks([a, b], rule("played", "played"), stats)).toEqual([a]);
    expect(smartTracks([a, b], rule("plays", "1", "at_least"), recordPlayed(stats, a.path))).toEqual([a]);
  });
  it("uses import time, falls back for old caches, and excludes future dates", () => {
    const now = 100 * 86400 * 1000;
    const recent = t("recent", { added: 99 * 86400 });
    const legacy = t("legacy", { modified: 98 * 86400 });
    const old = t("old", { added: 1, modified: 99 * 86400 });
    const future = t("future", { added: 101 * 86400 });
    expect(smartTracks([old, future, recent, legacy], rule("added", "3"), {}, now)).toEqual([legacy, recent]);
    expect(smartTracks([recent], rule("added", "3"), {}, now + 4 * 86400 * 1000)).toEqual([]);
  });
  it("rejects invalid or excessive persisted rules", () => {
    for (const raw of [null, [], {}, { match: "all", rules: [] }, rule("year", "NaN"), rule("added", "0"), rule("played", "wrong"), rule("artist", "", "contains"), rule("title", "x", "unknown")]) expect(sanitizeSmart(raw)).toBeUndefined();
    expect(smartProblem({ match: "all", rules: Array(21).fill(blankSmartRule("played")) })).not.toBeNull();
    expect(sanitizeSmart(rule("artist", "  A  "))?.rules[0].value).toBe("A");
  });
  it("preserves smart rules and legacy playlists across storage, with snapshot export", () => {
    const smart = createPlaylist("Auto", ["ignored"], 1, rule("played", "never"));
    const legacy = createPlaylist("Manual", [a.path], 2);
    expect(sanitizePlaylists(JSON.parse(JSON.stringify([smart, legacy])))).toEqual([smart, legacy]);
    expect(addPaths(smart, [a.path]).added).toBe(0);
    expect(removeAt(smart, 0)).toBe(smart);
    expect(moveTrack(smart, 0, 1)).toBe(smart);
    const snapshot = { ...smart, paths: smartTracks([a, b], smart.smart!, {}).map((v) => v.path) };
    expect(toM3u(snapshot, () => ({ title: "Song" }))).toContain(b.path);
    expect(smart.paths).toEqual([]);
  });
  it("caps generated playlists at 5000 songs", () => expect(smartTracks(Array.from({ length: 5002 }, (_, i) => t(String(i))), rule("played", "never"), {})).toHaveLength(5000));
});
describe("listening history", () => {
  it("validates saved values and counts immutably", () => {
    const saved = sanitizeListening({ a: { plays: 2.9, lastPlayed: 5 }, b: { plays: -1, lastPlayed: 0 }, c: { plays: Infinity, lastPlayed: 0 }, d: null });
    expect(saved).toEqual({ a: { plays: 2, lastPlayed: 5 } });
    expect(recordPlayed(saved, "a", 10)).toEqual({ a: { plays: 3, lastPlayed: 10 } });
    expect(saved.a.plays).toBe(2);
  });
});
