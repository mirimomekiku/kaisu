import { describe, expect, it } from "vitest";
import { refreshSource, sanitizeSavedSources, sourceUrl, type SavedSource } from "./savedSources";
import type { PlaylistInfo, SearchResult } from "./api";
const item = (id: string, live = false): SearchResult => ({ id, url: `https://youtube.com/watch?v=${id}`, title: id, thumbnail: "", channel: null, duration_secs: 10, view_count: null, live });
const base: SavedSource = { id: "source-1", url: "https://youtube.com/playlist?list=PL1", title: "Music", kind: "playlist", preset: "audio", audioFormat: "opus", playlistId: "pl-1", seen: [], pending: [], checked: 0, total: null };
const listing = (entries: SearchResult[]): PlaylistInfo => ({ title: "Music", kind: "playlist", uploader: null, total: entries.length, entries });
describe("saved sources", () => {
  it("finds new items while retaining unreviewed items outside the latest window", () => {
    const first = refreshSource(base, listing([item("aaaaaaaaaaa"), item("bbbbbbbbbbb")]), 1);
    const next = refreshSource(first, listing([item("ccccccccccc"), item("aaaaaaaaaaa")]), 2);
    expect(next.pending.map((e) => e.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
    expect(next.seen).toHaveLength(3); expect(next.checked).toBe(2);
  });
  it("does not rediscover reviewed items and recognizes equivalent YouTube links", () => {
    const first = { ...refreshSource(base, listing([item("aaaaaaaaaaa")])), pending: [] };
    const next = refreshSource(first, listing([{ ...item("aaaaaaaaaaa"), url: "https://youtu.be/aaaaaaaaaaa?t=20" }]));
    expect(next.pending).toEqual([]);
  });
  it("updates a live pending item when it becomes downloadable", () => {
    const first = refreshSource(base, listing([item("aaaaaaaaaaa", true)]));
    expect(refreshSource(first, listing([item("aaaaaaaaaaa")])).pending[0].live).toBe(false);
  });
  it("rejects credential-bearing links and sanitizes malformed saved records", () => {
    for (const url of ["file:///x", "https://u:p@example.com/list", "https://example.com/list?token=private", "--exec calc"]) expect(sourceUrl(url)).toBeNull();
    expect(sanitizeSavedSources([null, { ...base, preset: "invalid", pending: [null, item("aaaaaaaaaaa")], seen: [null] }])).toMatchObject([{ preset: "best", audioFormat: "opus", playlistId: "pl-1", pending: [{ id: "aaaaaaaaaaa" }] }]);
  });
});
