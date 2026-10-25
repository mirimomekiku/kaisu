import { describe, expect, it } from "vitest";
import { defaultPlaybackProfiles, sanitizePlaybackProfiles } from "./playbackProfiles";
describe("playback profiles", () => {
  it("offers independent music, speech and practice defaults", () => {
    const profiles = defaultPlaybackProfiles(); expect(profiles.map((p) => p.name)).toEqual(["Music", "Spoken audio", "Practice"]);
    expect(profiles[1]).toMatchObject({ rate: 1.25, gaplessPlayback: false, resumeLongTracks: true });
    expect(profiles[2]).toMatchObject({ rate: .75, gaplessPlayback: false, resumeLongTracks: false });
  });
  it("validates stored profiles and nested equalizers", () => {
    const value = { ...defaultPlaybackProfiles()[0], rate: 100, crossfadeSeconds: -5, equalizer: { bands: [99] } };
    const result = sanitizePlaybackProfiles([null, {}, value, value]); expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rate: 2, crossfadeSeconds: 0 }); expect(result[0].equalizer.bands[0]).toBe(12);
    expect(sanitizePlaybackProfiles(undefined)).toHaveLength(3);
  });
});
