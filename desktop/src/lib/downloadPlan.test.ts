import { describe, expect, it } from "vitest";
import { downloadPlan } from "./downloadPlan";
import { buildExtra } from "./extra";
import { blankSiteRule } from "./siteRules";
import { DEFAULT_SETTINGS, type Settings } from "./storage";

const rule = { ...blankSiteRule(), host: "example.com", audioFormat: "flac" as const, folder: "/music/ex" };
const advanced = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, mode: "advanced", siteRules: [rule], ...patch });

describe("download plan", () => {
  it("names a matching site rule and says it overrides the card", () => {
    const plan = downloadPlan(advanced(), "https://www.example.com/watch?v=1", null);
    expect(plan.rule).toMatch(/example\.com/);
    expect(plan.rule).toMatch(/FLAC/);
    expect(plan.rule).toMatch(/overrides/);
  });
  it("has no rule for other sites or in Simple mode", () => {
    expect(downloadPlan(advanced(), "https://other.org/x", null).rule).toBeNull();
    expect(downloadPlan({ ...advanced(), mode: "simple" }, "https://example.com/x", null).rule).toBeNull();
  });
  it("describes the folder layout and file naming", () => {
    const plan = downloadPlan(advanced({ layout: "music", nameStyle: "track_title" }), "https://other.org/x", null);
    expect(plan.output).toBe("Artist / Album folders (for music) · Track number - Title");
    expect(downloadPlan(advanced({ customName: "%(title)s" }), "https://other.org/x", null).output).toContain('custom name "%(title)s"');
  });
});

describe("original audio in a request", () => {
  it("never sends conversion options with it", () => {
    const settings = advanced({ audioFormat: "original", audioNormalize: true, audioTrimSilence: true, audioQuality: "128K" });
    const extra = buildExtra(settings, null);
    expect(extra.audio_format).toBe("original");
    expect(extra.audio).toEqual({ quality: null, normalize: false, trim_silence: false });
  });
  it("keeps them for converted formats", () => {
    const extra = buildExtra(advanced({ audioFormat: "mp3", audioNormalize: true }), null);
    expect(extra.audio?.normalize).toBe(true);
  });
});
