import { describe, expect, it } from "vitest";
import { addPaths, checkName, createPlaylist, m3uFileName, moveTrack, removeAt, sanitizePlaylists, toM3u, MAX_NAME_CHARS } from "./playlists";

describe("checkName", () => {
  const others = [createPlaylist("Road trip"), createPlaylist("Focus")];
  it("accepts a fresh name", () => expect(checkName("Gym", others)).toBeNull());
  it("asks for a name", () => expect(checkName("   ", others)).toMatch(/name/));
  it("refuses a name that is taken, whatever the capitals", () => {
    expect(checkName("road TRIP", others)).toMatch(/already/);
    expect(checkName(" Focus ", others)).toMatch(/already/);
  });
  it("lets a playlist keep its own name when renamed", () => expect(checkName("Focus", others, others[1].id)).toBeNull());
  it("limits the length", () => expect(checkName("x".repeat(MAX_NAME_CHARS + 1), others)).toMatch(/80/));
});

describe("changing a playlist", () => {
  it("creates one with the files once each", () => {
    const p = createPlaylist("  Mix ", ["/a", "/b", "/a"], 5);
    expect(p).toMatchObject({ name: "Mix", paths: ["/a", "/b"], updated: 5 });
    expect(p.id).toMatch(/^pl-/);
  });

  it("adds only what isn't there yet, at the end", () => {
    const p = createPlaylist("Mix", ["/a", "/b"], 1);
    const r = addPaths(p, ["/b", "/c", "/c", "/d"], 9);
    expect(r.playlist.paths).toEqual(["/a", "/b", "/c", "/d"]);
    expect(r).toMatchObject({ added: 2 });
    expect(r.playlist.updated).toBe(9);
    const same = addPaths(r.playlist, ["/a"], 10);
    expect(same.playlist).toBe(r.playlist);
    expect(same.added).toBe(0);
  });

  it("removes and moves files without touching the original", () => {
    const p = createPlaylist("Mix", ["/a", "/b", "/c"], 1);
    expect(removeAt(p, 1, 2).paths).toEqual(["/a", "/c"]);
    expect(removeAt(p, 9)).toBe(p);
    expect(moveTrack(p, 0, 2, 3).paths).toEqual(["/b", "/c", "/a"]);
    expect(moveTrack(p, 1, 1)).toBe(p);
    expect(moveTrack(p, 0, 9)).toBe(p);
    expect(p.paths).toEqual(["/a", "/b", "/c"]);
  });
});

describe("sanitizePlaylists", () => {
  it("keeps only what is shaped like a playlist", () => {
    expect(sanitizePlaylists(undefined)).toEqual([]);
    const out = sanitizePlaylists([null, 4, { name: "" , paths: [] }, { id: "x", name: " Good ", paths: ["/a", 5, "", "/b"], updated: 7 }, { id: "x", name: "Same id", paths: [] }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: "x", name: "Good", paths: ["/a", "/b"], updated: 7 });
    expect(out[1].id).not.toBe("x");
  });
});

describe("toM3u", () => {
  const p = createPlaylist("My Mix\nline", ["/m/a.mp3", "/m/missing.mp3", "C:\\Music\\b.flac"], 1);
  const info = (path: string) => ({ "/m/a.mp3": { title: "A", artist: "Band", duration: 200.4 }, "C:\\Music\\b.flac": { title: "B" } })[path];
  it("writes an extended M3U with the length and name of each song", () => {
    expect(toM3u(p, info)).toBe(["#EXTM3U", "#PLAYLIST:My Mix line", "#EXTINF:200,Band - A", "/m/a.mp3", "/m/missing.mp3", "#EXTINF:-1,B", "C:\\Music\\b.flac", ""].join("\n"));
  });
  it("is just a header for an empty playlist", () => {
    expect(toM3u(createPlaylist("Empty"), () => undefined)).toBe("#EXTM3U\n#PLAYLIST:Empty\n");
  });
});

describe("m3uFileName", () => {
  it("makes a safe file name", () => {
    expect(m3uFileName("Road trip")).toBe("Road trip.m3u8");
    expect(m3uFileName('A/B:C*D?"E')).toBe("A_B_C_D__E.m3u8");
    expect(m3uFileName("  ...  ")).toBe("Playlist.m3u8");
  });
});
