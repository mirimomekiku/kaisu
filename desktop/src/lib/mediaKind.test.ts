import { describe, expect, it } from "vitest";
import { baseName, extensionOf, isAudioFile } from "./mediaKind";

describe("mediaKind", () => {
  it("tells sound from video by the file's extension", () => {
    for (const p of ["/a/b.mp3", "C:\\Music\\track.FLAC", "song.opus", "/x/y.m4a"]) expect(isAudioFile(p)).toBe(true);
    for (const p of ["/a/b.mp4", "C:\\Videos\\clip.MKV", "clip.webm", "noext", ""]) expect(isAudioFile(p)).toBe(false);
  });

  it("reads extensions and names from Windows and Linux paths", () => {
    expect(extensionOf("C:\\Users\\me\\Song [abc].f251.WEBM")).toBe("webm");
    expect(baseName("C:\\Users\\me\\Song [abc].mp3")).toBe("Song [abc]");
    expect(baseName("/home/me/a.b.c.mp4")).toBe("a.b.c");
  });
});
