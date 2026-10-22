import { describe, expect, it } from "vitest";
import { episodeDate, feedUrl, MAX_SEEN, newEpisodes, podcastFolder, rememberEpisodes, sanitizePodcasts, showFolder } from "./podcasts";
import type { PodcastFeed } from "./api";

const episode = (id: string) => ({ id, title: id, url: `https://example.com/${id}.mp3`, published: null, duration: null, size: null });

describe("podcast subscriptions", () => {
  it("accepts web feeds and normalizes fragments without allowing logins", () => {
    expect(feedUrl(" HTTPS://EXAMPLE.COM/feed#top ")).toBe("https://example.com/feed");
    for (const url of ["", "feed", "file:///feed", "https://me:pw@example.com/feed", "javascript:alert(1)"]) expect(feedUrl(url)).toBeNull();
  });

  it("keeps only unseen unique episodes in feed order", () => {
    const feed: PodcastFeed = { title: "Show", image: null, episodes: [episode("3"), episode("2"), episode("3"), episode("1")] };
    expect(newEpisodes(feed, ["1"] ).map((e) => e.id)).toEqual(["3", "2"]);
    expect(newEpisodes(feed, ["1", "2", "3"])).toEqual([]);
  });

  it("remembers recent episode ids without unbounded growth", () => {
    expect(rememberEpisodes(["a", "b", "a"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(rememberEpisodes(Array.from({ length: 700 }, (_, i) => `${i}`), [])).toHaveLength(MAX_SEEN);
  });

  it("makes show titles safe single folder names on both platforms", () => {
    expect(showFolder(" A/B: Show? ")).toBe("A_B_ Show_");
    for (const name of ["", ".", "..", "   ..."]) expect(showFolder(name)).toBe("Podcast");
    expect(showFolder("CON")).toBe("_CON");
    expect(showFolder("lpt1.txt")).toBe("_lpt1.txt");
    expect(showFolder("é".repeat(100)).length).toBeLessThanOrEqual(64);
    expect(podcastFolder("D:\\Music\\", "../Show")).toBe("D:\\Music/Podcasts/.._Show");
    expect(podcastFolder("/home/me/Music/", "Show")).toBe("/home/me/Music/Podcasts/Show");
  });

  it("reads publication dates and tolerates missing or invalid ones", () => {
    expect(episodeDate("Fri, 02 Jan 2026 10:00:00 +0000")).toBe(Date.UTC(2026, 0, 2, 10));
    expect(episodeDate(null)).toBeNull();
    expect(episodeDate("tomorrow-ish")).toBeNull();
  });

  it("sanitizes persisted data, deduplicates urls, and keeps auto-download opt-in", () => {
    expect(sanitizePodcasts(null)).toEqual([]);
    const saved = sanitizePodcasts([
      null, { url: "file:///feed", title: "Bad" }, { url: "https://a.example/feed", title: "  Show  ", id: "one", auto: "yes", seen: ["a", "a", 3], checked: Infinity, image: "javascript:x" },
      { url: "https://a.example/feed#top", title: "Same feed" },
      { url: "https://b.example/feed", title: "Other", id: "one", auto: true, checked: 42 },
    ]);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ title: "Show", auto: false, seen: ["a"], checked: 0, image: undefined });
    expect(saved[1]).toMatchObject({ auto: true, checked: 42 });
    expect(saved[1].id).not.toBe(saved[0].id);
  });
});
