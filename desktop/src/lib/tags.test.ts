import { describe, expect, it } from "vitest";
import { changedTags, guessTags, stripNoise } from "./tags";

const base = { title: "", uploader: null, artist: null, track: null, album: null, release_year: null, genre: null };

describe("tags", () => {
  it("strips decorations from titles", () => {
    expect(stripNoise("Song (Official Video) [HD]")).toBe("Song");
    expect(stripNoise("Keep (Live in Paris)")).toBe("Keep (Live in Paris)");
  });

  it("uses what the site knows", () => {
    expect(guessTags({ ...base, title: "x", artist: "Daft Punk", track: "One More Time", album: "Discovery", release_year: 2001 })).toMatchObject({
      artist: "Daft Punk",
      title: "One More Time",
      album: "Discovery",
      year: "2001",
    });
  });

  it("splits 'Artist - Title' and drops topic channels", () => {
    expect(guessTags({ ...base, title: "Daft Punk - One More Time (Official Video)", uploader: "DaftPunkVEVO" })).toMatchObject({ artist: "Daft Punk", title: "One More Time" });
    expect(guessTags({ ...base, title: "Plain title", uploader: "Some Artist - Topic" })).toMatchObject({ artist: "Some Artist", title: "Plain title" });
    expect(guessTags({ ...base, title: "Other - Thing", uploader: "X", artist: "Real" })).toMatchObject({ artist: "Real", title: "Other - Thing" });
  });

  it("reports only what changed", () => {
    const start = guessTags({ ...base, title: "T", uploader: "U" });
    expect(changedTags({ ...start }, start)).toBeNull();
    expect(changedTags({ ...start, album: "A", year: "2020" }, start)).toEqual({ album: "A", year: "2020" });
    expect(changedTags({ ...start, title: "" }, start)).toBeNull();
  });
});

import { headsUp } from "./tags";

describe("heads up", () => {
  const info = { availability: "public", age_limit: 0, live_status: "not_live", is_live: false };
  it("says nothing for ordinary videos", () => expect(headsUp(info, false)).toEqual([]));
  it("warns about sign-in, members and age limits", () => {
    expect(headsUp({ ...info, availability: "needs_auth" }, false)[0]).toMatch(/signed in.*Advanced mode/);
    expect(headsUp({ ...info, availability: "subscriber_only" }, true)[0]).toMatch(/members only.*browser's login will be used/);
    expect(headsUp({ ...info, age_limit: 18 }, false)[0]).toMatch(/age-restricted/);
    expect(headsUp({ ...info, availability: "private" }, false)[0]).toMatch(/private/);
  });
  it("warns about live streams", () => {
    expect(headsUp({ ...info, live_status: "is_upcoming" }, false)[0]).toMatch(/hasn't started/);
    expect(headsUp({ ...info, is_live: true }, false)[0]).toMatch(/live stream/);
  });
});
