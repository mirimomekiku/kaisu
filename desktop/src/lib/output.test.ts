import { describe, expect, it } from "vitest";
import { checkCustomName, previewPath, type OutputPrefs } from "./output";

const prefs = (over: Partial<OutputPrefs> = {}): OutputPrefs => ({ layout: "flat", nameStyle: "title_id", customName: "", playlistFolder: true, playlistNumbering: true, ...over });

describe("previewPath", () => {
  it("matches the defaults", () => {
    expect(previewPath(prefs())).toBe("Big Buck Bunny [aqz-KE-bpKQ].mp4");
  });
  it("layouts", () => {
    expect(previewPath(prefs({ layout: "channel" }))).toBe("Blender/Big Buck Bunny [aqz-KE-bpKQ].mp4");
    expect(previewPath(prefs({ layout: "kind" }), { audio: true })).toBe("Audio/Big Buck Bunny [aqz-KE-bpKQ].mp3");
    expect(previewPath(prefs({ layout: "year" }))).toBe("2014/Big Buck Bunny [aqz-KE-bpKQ].mp4");
  });
  it("name styles", () => {
    expect(previewPath(prefs({ nameStyle: "title" }))).toBe("Big Buck Bunny.mp4");
    expect(previewPath(prefs({ nameStyle: "channel_title" }))).toBe("Blender - Big Buck Bunny.mp4");
    expect(previewPath(prefs({ nameStyle: "date_title" }))).toBe("2014-05-30 - Big Buck Bunny.mp4");
  });
  it("playlists", () => {
    expect(previewPath(prefs(), { playlist: true })).toBe("Road Trip Mix/04 - Big Buck Bunny [aqz-KE-bpKQ].mp4");
    expect(previewPath(prefs({ playlistFolder: false, playlistNumbering: false }), { playlist: true })).toBe("Big Buck Bunny [aqz-KE-bpKQ].mp4");
  });
  it("custom templates replace layout and name", () => {
    expect(previewPath(prefs({ customName: "%(channel)s/%(title)s", layout: "year" }))).toBe("Blender/Big Buck Bunny.mp4");
    expect(previewPath(prefs({ customName: "%(title).50B - %(id)s.%(ext)s" }))).toBe("Big Buck Bunny - aqz-KE-bpKQ.mp4");
  });
});

describe("checkCustomName", () => {
  it("accepts reasonable templates and empty input", () => {
    for (const ok of ["", "%(channel)s/%(title)s", "Music/%(title)s [%(id)s]", "100%% great %(title)s"]) expect(checkCustomName(ok), ok).toBeNull();
  });
  it("explains the common mistakes", () => {
    expect(checkCustomName("../x/%(title)s")).toMatch(/'\.\.'/);
    expect(checkCustomName("/etc/%(title)s")).toMatch(/relative/);
    expect(checkCustomName("C:/x")).toMatch(/relative/);
    expect(checkCustomName("a\\b")).toMatch(/Use \//);
    expect(checkCustomName("bad:name")).toMatch(/can't contain/);
    expect(checkCustomName("a//b")).toMatch(/empty/);
  });
});
