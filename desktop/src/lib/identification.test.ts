import { describe, expect, it } from "vitest";
import { identificationEdit, suggestedForm } from "./identification";
import { startForm } from "./tagEdit";
import type { LibTrack } from "./api";
describe("reviewed music identification", () => {
  it("changes only checked fields and never clears missing service metadata", () => {
    const current = startForm([{ title: "Old title", artist: "Artist", album: "Existing album", album_artist: "Artist", genre: "Rock", track: 1, disc: 1, year: 2000 } as LibTrack]).values;
    const tags = { title: "New title", artist: "Artist", album: null, genre: "", year: "2001", track: "2" };
    expect(identificationEdit(current, tags, new Set(["title", "artist", "album", "genre", "year"]))).toEqual({ title: "New title", year: "2001" });
    expect(suggestedForm(tags)).not.toHaveProperty("album");
    expect(identificationEdit(current, tags, new Set())).toEqual({});
    expect(current.album).toBe("Existing album");
  });
});
