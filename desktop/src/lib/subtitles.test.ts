import { describe, expect, it } from "vitest";
import { defaultSelection, parseLangs, toOptions, trackMatches } from "./subtitles";

const tracks = [
  { code: "en", name: "English", auto: false },
  { code: "de", name: "German", auto: false },
  { code: "pt-BR", name: "Portuguese (Brazil)", auto: true },
];

describe("subtitles", () => {
  it("parses language lists", () => {
    expect(parseLangs("en, de;  fr en")).toEqual(["en", "de", "fr"]);
    expect(parseLangs("  ")).toEqual([]);
  });

  it("matches regional variants", () => {
    expect(trackMatches("en-US", "en")).toBe(true);
    expect(trackMatches("en-orig", "en.*")).toBe(true);
    expect(trackMatches("fil", "fi")).toBe(false);
    expect(trackMatches("PT-br", "pt")).toBe(true);
  });

  it("preselects tracks that match the preferences", () => {
    expect(defaultSelection(tracks, ["en", "pt", "ja"])).toEqual(["en", "pt-BR"]);
    expect(defaultSelection(tracks, [])).toEqual([]);
  });

  it("builds backend options", () => {
    expect(toOptions("off", ["en"], true)).toBeNull();
    expect(toOptions("embed", [], true)).toBeNull();
    expect(toOptions("embed", ["en"], false)).toEqual({ langs: ["en"], auto: false, embed: true, file: false });
    expect(toOptions("file", ["en"], true)).toEqual({ langs: ["en"], auto: true, embed: false, file: true });
    expect(toOptions("both", ["en"], true)).toEqual({ langs: ["en"], auto: true, embed: true, file: true });
  });
});
