import { describe, expect, it } from "vitest";
import { extractUrls, isMediaHost, playlistOf, shortLink } from "./links";

describe("extractUrls", () => {
  it("finds links in prose and drops trailing punctuation", () => {
    expect(extractUrls("see https://youtu.be/abc, and (https://vimeo.com/1).")).toEqual(["https://youtu.be/abc", "https://vimeo.com/1"]);
  });
  it("handles one-per-line lists and duplicates", () => {
    expect(extractUrls("https://a.com/1\nhttps://a.com/1\r\nhttps://b.com/2")).toEqual(["https://a.com/1", "https://b.com/2"]);
  });
  it("ignores everything that isn't http(s)", () => {
    expect(extractUrls("ftp://x file:///etc/passwd javascript:alert(1) just words")).toEqual([]);
  });
  it("stops at quotes and angle brackets (HTML drops)", () => {
    expect(extractUrls('<a href="https://x.com/a">x</a>')).toEqual(["https://x.com/a"]);
  });
});

describe("isMediaHost", () => {
  it("accepts well-known media sites and their subdomains", () => {
    for (const u of ["https://www.youtube.com/watch?v=1", "https://m.youtube.com/x", "https://youtu.be/x", "https://vimeo.com/1", "https://artist.bandcamp.com/track/x", "https://x.com/a/status/1"]) expect(isMediaHost(u), u).toBe(true);
  });
  it("rejects ordinary sites and look-alikes", () => {
    for (const u of ["https://example.com/a", "https://notyoutube.com/a", "https://youtube.com.evil.example/a", "not a url", ""]) expect(isMediaHost(u), u).toBe(false);
  });
});

describe("playlistOf", () => {
  it("finds the playlist a video belongs to", () => {
    expect(playlistOf("https://www.youtube.com/watch?v=abc&list=PLxyz")).toEqual({ id: "PLxyz", url: "https://www.youtube.com/playlist?list=PLxyz" });
  });
  it("skips auto-generated mixes and other sites", () => {
    expect(playlistOf("https://www.youtube.com/watch?v=abc&list=RDabc")).toBeNull();
    expect(playlistOf("https://vimeo.com/1?list=PL1")).toBeNull();
    expect(playlistOf("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(playlistOf("nonsense")).toBeNull();
  });
});

describe("shortLink", () => {
  it("drops the scheme and www, and shortens long links", () => {
    expect(shortLink("https://www.youtube.com/watch?v=abc")).toBe("youtube.com/watch?v=abc");
    expect(shortLink(`https://example.com/${"x".repeat(100)}`, 20)).toHaveLength(20);
  });
});
