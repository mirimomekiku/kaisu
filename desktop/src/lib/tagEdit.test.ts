import { describe, expect, it } from "vitest";
import type { LibTrack } from "./api";
import { buildEdit, startForm, validateForm, type TagForm } from "./tagEdit";

const t = (over: Partial<LibTrack> = {}): LibTrack => ({
  path: "/m/a.mp3", title: "Song", artist: "Band", album_artist: "", album: "Record", track: 3, disc: null, year: 1999, genre: "Rock", duration: 200, bitrate: 192,
  sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1, modified: 1, has_cover: false, loudness: null, ...over,
});

describe("startForm", () => {
  it("shows one song's tags as they are", () => {
    const { values, mixed } = startForm([t()]);
    expect(values).toEqual({ title: "Song", artist: "Band", album: "Record", albumArtist: "", genre: "Rock", track: "3", disc: "", year: "1999" });
    expect(mixed.size).toBe(0);
  });

  it("shows what several songs share, and marks what differs", () => {
    const { values, mixed } = startForm([t({ title: "A", track: 1 }), t({ title: "B", track: 2 }), t({ title: "C", track: 3, genre: "Pop" })]);
    expect(values.artist).toBe("Band");
    expect(values.album).toBe("Record");
    expect([...mixed].sort()).toEqual(["genre", "title", "track"]);
    expect(values.title).toBe("");
  });
});

describe("buildEdit", () => {
  const start = startForm([t()]);
  const form = (over: Partial<TagForm> = {}): TagForm => ({ ...start.values, ...over });

  it("sends nothing when nothing changed", () => {
    expect(buildEdit(start, form())).toEqual({});
    expect(buildEdit(start, form({ title: "  Song  " }))).toEqual({});
  });

  it("sends only the fields that changed", () => {
    expect(buildEdit(start, form({ title: "New", year: "2001" }))).toEqual({ title: "New", year: "2001" });
    expect(buildEdit(start, form({ albumArtist: "Various" }))).toEqual({ album_artist: "Various" });
  });

  it("sends an empty value to remove a field", () => {
    expect(buildEdit(start, form({ genre: "", track: "" }))).toEqual({ genre: "", track: "" });
  });

  it("leaves a mixed field alone unless something is typed in it", () => {
    const several = startForm([t({ title: "A" }), t({ title: "B" })]);
    expect(buildEdit(several, { ...several.values })).toEqual({});
    expect(buildEdit(several, { ...several.values, title: "Same for all" })).toEqual({ title: "Same for all" });
    expect(buildEdit(several, { ...several.values, album: "New Record" })).toEqual({ album: "New Record" });
  });
});

describe("validateForm", () => {
  const ok = startForm([t()]).values;
  it("accepts a sensible form, empty numbers included", () => {
    expect(validateForm(ok)).toEqual({});
    expect(validateForm({ ...ok, year: "", track: "", disc: "" })).toEqual({});
  });
  it("explains numbers that are wrong", () => {
    expect(validateForm({ ...ok, year: "99" }).year).toMatch(/1000 to 2999/);
    expect(validateForm({ ...ok, year: "20x1" }).year).toBeDefined();
    expect(validateForm({ ...ok, track: "0" }).track).toMatch(/1 to 999/);
    expect(validateForm({ ...ok, disc: "100" }).disc).toMatch(/1 to 99/);
    expect(validateForm({ ...ok, track: "-2" }).track).toBeDefined();
  });
  it("limits how long text can be", () => {
    expect(validateForm({ ...ok, title: "x".repeat(201) }).title).toMatch(/too long/);
    expect(validateForm({ ...ok, title: "x".repeat(200) })).toEqual({});
  });
});
