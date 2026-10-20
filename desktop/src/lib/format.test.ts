import { describe, expect, it } from "vitest";
import { clipKeyOf, clipLabel, formatBytes, formatClock, formatCount, formatDuration, formatEta, formatSpeed, formatUploadDate, parseTimeInput } from "./format";

describe("formatDuration / formatClock", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(null)).toBe("--:--");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatClock(79.6)).toBe("1:20");
  });
});

describe("parseTimeInput", () => {
  it("reads the ways people type times", () => {
    expect(parseTimeInput("90")).toBe(90);
    expect(parseTimeInput("1:30")).toBe(90);
    expect(parseTimeInput("1:02:03")).toBe(3723);
    expect(parseTimeInput("90:00")).toBe(5400);
    expect(parseTimeInput(" 0:10.5 ")).toBe(10.5);
  });
  it("rejects what isn't a time", () => {
    for (const bad of ["", "abc", "1:60", "1:2:3:4", "-5", "1,5", "1:", ":30", "1:75:00"]) expect(parseTimeInput(bad), bad).toBeNull();
  });
});

describe("clip keys", () => {
  it("round trip into a label", () => {
    expect(clipKeyOf({ start: 80, end: 165 })).toBe("80-165");
    expect(clipKeyOf(null)).toBeUndefined();
    expect(clipLabel("80-165")).toBe("1:20 to 2:45");
    expect(clipLabel(undefined)).toBe("");
    expect(clipLabel("junk")).toBe("");
  });
});

describe("numbers", () => {
  it("formatCount", () => {
    expect([null, 0, 999, 1234, 45210, 445392114, 2_000_000_000].map(formatCount)).toEqual(["", "0", "999", "1.2K", "45.2K", "445M", "2B"]);
  });
  it("formatBytes", () => {
    expect(formatBytes(3_200_000)).toBe("3.1 MB");
    expect(formatBytes(94 * 1_048_576)).toBe("94 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
  it("speed and eta", () => {
    expect(formatSpeed(null)).toBe("");
    expect(formatSpeed(6_400_000)).toBe("6.1 MB/s");
    expect(formatSpeed(200_000)).toBe("195 KB/s");
    expect(formatEta(45)).toBe("45s left");
    expect(formatEta(125)).toBe("2m 5s left");
  });
});

describe("formatUploadDate", () => {
  it("formats yt-dlp dates and tolerates junk", () => {
    expect(formatUploadDate("20140530")).toMatch(/2014/);
    expect(formatUploadDate("garbage")).toBe("");
    expect(formatUploadDate(null)).toBe("");
  });
});
