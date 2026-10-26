import { describe, expect, it } from "vitest";
import { lrcStamp, lyricProblem, shiftLyrics, stampLyricLine } from "./lyricsEdit";
import { parseLrc } from "./lrc";
describe("lyrics editing", () => {
  it("shifts repeated timestamps and folds offsets into the playback times", () => {
    const input = "[ar:Artist]\n[offset:500]\n[00:01.00][00:03.00]Hello\n[00:00.20]Early";
    const result = shiftLyrics(input, 0.25);
    expect(result).toBe("[ar:Artist]\n[00:00.75][00:02.75]Hello\n[00:00.00]Early");
    expect(parseLrc(result).map((l) => l.time)).toEqual([0, 0.75, 2.75]);
  });
  it("stamps the selected content line and advances past metadata and blank lines", () => {
    const result = stampLyricLine("[offset:500]\nFirst\n\nSecond", 1, 12.345);
    expect(result).toEqual({ text: "[00:12.35]First\n\nSecond", next: 2 });
    expect(() => stampLyricLine("[ar:Artist]\nWords", 0, 3)).toThrow("lyric line");
    expect(() => stampLyricLine("[offset:500]\nWords", 0, 3)).toThrow("lyric line");
  });
  it("keeps plain text, validates timestamps, and rejects unsafe or excessive edits", () => {
    expect(lyricProblem("Words\n[Chorus]\nMore words")).toBeNull();
    expect(lyricProblem("[00:61.00]Invalid")).toContain("seconds");
    expect(lyricProblem("[00:bad]Invalid")).toContain("timestamps");
    expect(lyricProblem("a\0b")).toContain("NUL");
    expect(lyricProblem("é".repeat(262145))).toContain("512 KB");
    expect(() => shiftLyrics("[00:01]Words", NaN)).toThrow();
    expect(lrcStamp(59.999)).toBe("[01:00.00]");
  });
});
