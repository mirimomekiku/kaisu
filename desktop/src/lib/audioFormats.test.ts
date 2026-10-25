import { describe, expect, it } from "vitest";
import { AUDIO_FORMAT_IDS, audioFormatName, forFormat, isAudioFormat, lossyEncodeNote, originalIgnores } from "./audioFormats";

describe("audio formats", () => {
  it("lists original audio and recognises only known formats", () => {
    expect(AUDIO_FORMAT_IDS).toContain("original");
    expect(isAudioFormat("flac")).toBe(true);
    expect(isAudioFormat("aac")).toBe(false);
    expect(audioFormatName("original")).toBe("Original");
    expect(audioFormatName("mp3")).toBe("MP3");
  });
  it("warns that lossless formats cannot restore lost quality, and only those", () => {
    expect(lossyEncodeNote("flac")).toMatch(/does not restore quality/);
    expect(lossyEncodeNote("wav")).toMatch(/WAV/);
    for (const f of ["mp3", "m4a", "opus", "original"] as const) expect(lossyEncodeNote(f)).toBeNull();
  });
  it("drops conversion options when the audio is kept as it is", () => {
    const options = { quality: "192K", normalize: true, trim_silence: true };
    expect(originalIgnores(options)).toBe(true);
    expect(originalIgnores({ quality: null, normalize: false, trim_silence: false })).toBe(false);
    expect(forFormat("original", options)).toEqual({ quality: null, normalize: false, trim_silence: false });
    expect(forFormat("mp3", options)).toBe(options);
    expect(forFormat("original", null)).toBeNull();
  });
});
