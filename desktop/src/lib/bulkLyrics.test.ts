import { describe, expect, it } from "vitest";
import type { LibTrack } from "./api";
import { lyricsFailure, lyricsOutcome, lyricsTargets, MAX_LYRICS_RUN } from "./bulkLyrics";

describe("bulk lyrics", () => {
  it("tells a song with no lyrics from a service problem", () => {
    expect(lyricsFailure("No lyrics were found for Band - Song.")).toBe("none");
    expect(lyricsFailure("Couldn't reach the lyrics service: timed out")).toBe("stop");
    expect(lyricsFailure("The lyrics service answered 429 Too Many Requests.")).toBe("stop");
    expect(lyricsFailure("The lyrics service answered 503.")).toBe("stop");
    expect(lyricsFailure("Couldn't save the lyrics: Access is denied")).toBe("failed");
  });
  it("calls timed lyrics timed and anything else plain", () => {
    expect(lyricsOutcome({ synced: "[00:01.00] a", plain: null, source: "online" })).toBe("timed");
    expect(lyricsOutcome({ synced: null, plain: "a", source: "online" })).toBe("plain");
  });
  it("skips missing files and limits a run", () => {
    const tracks = Array.from({ length: MAX_LYRICS_RUN + 10 }, (_, i) => ({ path: `/m/${i}.mp3`, missing: i === 0 }) as LibTrack);
    const targets = lyricsTargets(tracks);
    expect(targets).toHaveLength(MAX_LYRICS_RUN);
    expect(targets.some((t) => t.missing)).toBe(false);
  });
});
