import { describe, expect, it } from "vitest";
import type { Leftover } from "./api";
import { resumableVideos, titleFromLeftover, totalBytes } from "./leftovers";

const left = (name: string, video_id: string | null, size = 100): Leftover => ({ path: `/dl/${name}.part`, name, size, modified: 0, video_id, audio_only: false });

describe("titleFromLeftover", () => {
  it("leaves the title that was in the file's name", () => {
    expect(titleFromLeftover("Daft Punk - One More Time [FGBhQbmPwH8].f251.m4a")).toBe("Daft Punk - One More Time");
    expect(titleFromLeftover("Song [abcdefghijk].mp4")).toBe("Song");
    expect(titleFromLeftover("Plain title.webm")).toBe("Plain title");
    expect(titleFromLeftover("Song [abcdefghijk].mp4.part")).toBe("Song");
  });

  it("keeps something to show when nothing is left", () => {
    expect(titleFromLeftover("[abcdefghijk].mp4")).toBe("[abcdefghijk].mp4");
  });
});

describe("resumableVideos", () => {
  it("lists each video once, however many parts it left", () => {
    const list = [left("A [aaaaaaaaaaa].f137.mp4", "aaaaaaaaaaa"), left("A [aaaaaaaaaaa].f140.m4a", "aaaaaaaaaaa"), left("B [bbbbbbbbbbb].webm", "bbbbbbbbbbb"), left("no id.mp4", null)];
    expect(resumableVideos(list)).toEqual([
      { id: "aaaaaaaaaaa", title: "A" },
      { id: "bbbbbbbbbbb", title: "B" },
    ]);
  });
});

describe("totalBytes", () => {
  it("adds the sizes", () => {
    expect(totalBytes([left("a", null, 5), left("b", null, 7)])).toBe(12);
    expect(totalBytes([])).toBe(0);
  });
});
