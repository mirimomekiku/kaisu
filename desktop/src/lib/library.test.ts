import { describe, expect, it } from "vitest";
import type { LibTrack } from "./api";
import { albumsOf, artistOf, artistsOf, filterTracks, formatsOf, isLossless, normalize, qualityLabel, sortTracks, toPlayerTrack } from "./library";

const t = (over: Partial<LibTrack>): LibTrack => ({
  path: `/m/${over.title ?? "x"}.mp3`,
  title: "x",
  artist: "",
  album_artist: "",
  album: "",
  track: null,
  disc: null,
  year: null,
  genre: "",
  duration: 200,
  bitrate: 192,
  sample_rate: 44100,
  bit_depth: null,
  channels: 2,
  format: "MP3",
  size: 1,
  modified: 1,
  has_cover: false,
  loudness: null,
  ...over,
});

const LIB = [
  t({ title: "Da Funk", artist: "Daft Punk", album: "Homework", track: 1, year: 1997, genre: "Electronic", modified: 30 }),
  t({ title: "Around the World", artist: "Daft Punk", album: "Homework", track: 3, year: 1997, modified: 10 }),
  t({ title: "Get Lucky", artist: "Daft Punk feat. Pharrell", album_artist: "Daft Punk", album: "Random Access Memories", track: 8, year: 2013, format: "FLAC", bit_depth: 16, modified: 20 }),
  t({ title: "Halo", artist: "Beyoncé", album: "I Am... Sasha Fierce", track: 3, year: 2008, modified: 40 }),
  t({ title: "Loose Single" }),
];

describe("names", () => {
  it("files tracks under the album artist, then the artist, then nobody", () => {
    expect(artistOf(LIB[2])).toBe("Daft Punk");
    expect(artistOf(LIB[0])).toBe("Daft Punk");
    expect(artistOf(LIB[4])).toBe("Unknown artist");
  });
  it("ignores accents and capitals", () => {
    expect(normalize("Beyoncé")).toBe("beyonce");
    expect(normalize("ÉCOLE")).toBe("ecole");
  });
});

describe("filterTracks", () => {
  const f = (query: string, format = "", artist = "") => filterTracks(LIB, { query, format, artist }).map((x) => x.title);
  it("finds every word anywhere in the title, artist, album or genre", () => {
    expect(f("daft funk")).toEqual(["Da Funk"]);
    expect(f("homework")).toEqual(["Da Funk", "Around the World"]);
    expect(f("electronic")).toEqual(["Da Funk"]);
    expect(f("beyonce")).toEqual(["Halo"]);
    expect(f("  ")).toHaveLength(5);
    expect(f("nothing like this")).toEqual([]);
  });
  it("can be limited to a format or an artist", () => {
    expect(f("", "FLAC")).toEqual(["Get Lucky"]);
    expect(f("", "", "Daft Punk")).toHaveLength(3);
    expect(f("lucky", "MP3")).toEqual([]);
  });
});

describe("sortTracks", () => {
  const order = (key: Parameters<typeof sortTracks>[1], desc = false) => sortTracks(LIB, key, desc).map((x) => x.title);
  it("sorts by name, artist, year, length and date added", () => {
    expect(order("title")[0]).toBe("Around the World");
    expect(order("artist")[0]).toBe("Halo");
    expect(order("year").slice(-1)).toEqual(["Get Lucky"]);
    expect(order("added")).toEqual(["Loose Single", "Around the World", "Get Lucky", "Da Funk", "Halo"]);
    expect(order("added", true)[0]).toBe("Halo");
  });
  it("keeps an album's tracks in track order", () => {
    const album = sortTracks(LIB, "album").filter((x) => x.album === "Homework");
    expect(album.map((x) => x.title)).toEqual(["Da Funk", "Around the World"]);
  });
  it("leaves the list it was given alone", () => {
    const copy = LIB.slice();
    sortTracks(LIB, "title", true);
    expect(LIB).toEqual(copy);
  });
});

describe("albumsOf and artistsOf", () => {
  it("groups tracks into albums under their artist, in track order", () => {
    const albums = albumsOf(LIB);
    const home = albums.find((a) => a.title === "Homework")!;
    expect(home.tracks.map((x) => x.title)).toEqual(["Da Funk", "Around the World"]);
    expect(home).toMatchObject({ artist: "Daft Punk", year: 1997, duration: 400 });
    // The featured-artist track joins its album through the album artist.
    expect(albums.find((a) => a.title === "Random Access Memories")!.artist).toBe("Daft Punk");
    // By artist, then by year.
    expect(albums.map((a) => a.title)).toEqual(["I Am... Sasha Fierce", "Homework", "Random Access Memories", "Unknown album"]);
  });
  it("keeps albums by different artists with the same name apart", () => {
    const two = albumsOf([t({ title: "a", artist: "A", album: "Greatest Hits" }), t({ title: "b", artist: "B", album: "Greatest Hits" })]);
    expect(two).toHaveLength(2);
  });
  it("lists artists with their album and track counts", () => {
    expect(artistsOf(LIB)).toEqual([
      { name: "Beyoncé", albums: 1, tracks: 1 },
      { name: "Daft Punk", albums: 2, tracks: 3 },
      { name: "Unknown artist", albums: 1, tracks: 1 },
    ]);
  });
});

describe("quality", () => {
  it("describes lossy and lossless files", () => {
    expect(qualityLabel(LIB[0])).toBe("MP3 · 192 kbps");
    expect(qualityLabel(LIB[2])).toBe("FLAC · 44.1 kHz · 16-bit");
    expect(qualityLabel(t({ format: "MP3", bitrate: null }))).toBe("MP3");
    expect(isLossless("flac")).toBe(true);
    expect(isLossless("MP3")).toBe(false);
  });
  it("lists the formats present", () => {
    expect(formatsOf(LIB)).toEqual(["FLAC", "MP3"]);
  });
});

describe("toPlayerTrack", () => {
  it("hands the player what it shows", () => {
    expect(toPlayerTrack(LIB[0])).toEqual({ path: LIB[0].path, title: "Da Funk", artist: "Daft Punk", album: "Homework", duration: 200 });
    expect(toPlayerTrack(t({ title: "z", duration: 0 }))).toMatchObject({ artist: undefined, album: undefined, duration: undefined });
  });
});
