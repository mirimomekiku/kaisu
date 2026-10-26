import { describe, expect, it } from "vitest";
import { sourceLyrics } from "./lyricsPolicy";
describe("source-specific lyrics", () => {
  it("automatically saves and embeds lyrics for YouTube Music audio", () => {
    expect(sourceLyrics("youtube_music", "audio", "off")).toBe("both");
    expect(sourceLyrics("youtube_music", "audio")).toBe("both");
    expect(sourceLyrics("youtube_music", "best", "both")).toBe("off");
  });
  it("preserves choices for other sources and never enables video lyrics", () => {
    for (const source of ["youtube", "soundcloud"] as const) {
      for (const choice of ["off", "file", "embed", "both"] as const) expect(sourceLyrics(source, "audio", choice)).toBe(choice);
      expect(sourceLyrics(source, "audio")).toBe("off");
      expect(sourceLyrics(source, "p720", "both")).toBe("off");
    }
  });
});
