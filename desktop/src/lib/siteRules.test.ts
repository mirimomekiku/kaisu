import { describe, expect, it } from "vitest";
import { blankSiteRule, describeSiteRule, matchSiteRule, normalizeHost, sanitizeSiteRules, validateSiteRule, type SiteRule } from "./siteRules";

const rule = (over: Partial<SiteRule> = {}): SiteRule => ({ ...blankSiteRule(), host: "example.com", preset: "audio", ...over });

describe("normalizeHost", () => {
  it("reduces what people type to a plain host", () => {
    expect(normalizeHost("YouTube.com")).toBe("youtube.com");
    expect(normalizeHost("https://www.Example.com:8080/watch?v=1")).toBe("example.com");
    expect(normalizeHost("  www.example.org/ ")).toBe("example.org");
    expect(normalizeHost("music.youtube.com")).toBe("music.youtube.com");
    expect(normalizeHost("")).toBe("");
  });
});

describe("validateSiteRule", () => {
  it("accepts a site with something to do", () => {
    expect(validateSiteRule(rule())).toBeNull();
    expect(validateSiteRule(rule({ preset: "", folder: "D:\\Music" }))).toBeNull();
    expect(validateSiteRule(rule({ preset: "", folder: "/home/me/Music" }))).toBeNull();
    expect(validateSiteRule(rule({ preset: "", audioFormat: "flac" }))).toBeNull();
  });

  it("says what is missing or wrong", () => {
    expect(validateSiteRule(rule({ host: "" }))).toMatch(/Enter the site/);
    expect(validateSiteRule(rule({ host: "localhost" }))).toMatch(/doesn't look like a site/);
    expect(validateSiteRule(rule({ host: "not a site.com" }))).toMatch(/doesn't look like a site/);
    expect(validateSiteRule(rule({ preset: "" }))).toMatch(/Choose what the rule should do/);
    expect(validateSiteRule(rule({ folder: "Music" }))).toMatch(/full path/);
    expect(validateSiteRule(rule({ folder: "..\\x" }))).toMatch(/full path/);
    expect(validateSiteRule(rule({ channel: "x".repeat(101) }))).toMatch(/too long/);
  });
});

describe("matchSiteRule", () => {
  const rules = [rule({ id: "a", host: "music.youtube.com", preset: "audio", audioFormat: "m4a" }), rule({ id: "b", host: "youtube.com", channel: "Lo-Fi Girl", folder: "D:\\Chill", preset: "" }), rule({ id: "c", host: "example.com" })];

  it("matches the site and its subdomains, the first rule winning", () => {
    expect(matchSiteRule(rules, "https://music.youtube.com/watch?v=1")?.id).toBe("a");
    expect(matchSiteRule(rules, "https://www.example.com/x")?.id).toBe("c");
    expect(matchSiteRule(rules, "https://cdn.example.com/x")?.id).toBe("c");
    expect(matchSiteRule(rules, "https://www.youtube.com/watch?v=1", "Lo-Fi Girl Official")?.id).toBe("b");
  });

  it("doesn't match other sites or look-alikes", () => {
    expect(matchSiteRule(rules, "https://notexample.com/x")).toBeNull();
    expect(matchSiteRule(rules, "https://example.com.evil.net/x")).toBeNull();
    expect(matchSiteRule(rules, "not a link")).toBeNull();
    expect(matchSiteRule(rules, "https://vimeo.com/1")).toBeNull();
  });

  it("needs the channel when the rule names one", () => {
    expect(matchSiteRule(rules, "https://www.youtube.com/watch?v=1", "Someone else")).toBeNull();
    expect(matchSiteRule(rules, "https://www.youtube.com/watch?v=1", null)).toBeNull();
    expect(matchSiteRule(rules, "https://www.youtube.com/watch?v=1", "lo-fi girl")?.id).toBe("b");
  });

  it("skips rules that can't be used", () => {
    expect(matchSiteRule([rule({ preset: "" })], "https://example.com/x")).toBeNull();
  });
});

describe("describeSiteRule", () => {
  it("says it in a sentence", () => {
    expect(describeSiteRule(rule({ audioFormat: "mp3", folder: "D:\\Podcasts" }))).toBe("Anything from example.com is downloaded as audio, audio as MP3, saved in D:\\Podcasts.");
    expect(describeSiteRule(rule({ channel: "News", preset: "p720" }))).toContain("News on example.com");
  });
});

describe("sanitizeSiteRules", () => {
  it("keeps only what is shaped like a rule", () => {
    expect(sanitizeSiteRules(undefined)).toEqual([]);
    expect(sanitizeSiteRules("nope")).toEqual([]);
    const out = sanitizeSiteRules([null, 5, { id: "x", host: "a.com", channel: 7, preset: "best", audioFormat: "exe", folder: "/m" }]);
    expect(out).toEqual([{ id: "x", host: "a.com", channel: "", preset: "best", audioFormat: "", folder: "/m" }]);
  });
});
