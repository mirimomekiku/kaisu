import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./storage";
import { settingsShape } from "./settingsValidation";

describe("persisted settings", () => {
  it("repairs wrong primitive types and nested schedules without discarding unrelated preferences", () => {
    const result = settingsShape({ schedule: null, audioQuality: 7, proxy: {}, outDir: 3, customArgs: null, mode: "unknown", theme: "dark", subtitleLangs: "es" }, DEFAULT_SETTINGS);
    expect(result).toMatchObject({ schedule: [], audioQuality: DEFAULT_SETTINGS.audioQuality, proxy: "", outDir: null, customArgs: "", mode: "simple", theme: "dark", subtitleLangs: "es" });
  });
  it("rejects invalid nested rules but keeps valid ones", () => {
    const good = { id: "valid", days: [1], from: "09:00", to: "17:00", action: "pause", limit: "" };
    expect(settingsShape({ schedule: [null, {}, { ...good, days: [9] }, { ...good, from: null }, good] }, DEFAULT_SETTINGS).schedule).toEqual([good]);
  });
  it("uses defaults for a non-object settings value", () => {
    for (const value of [null, [], "broken", 5]) expect(settingsShape(value, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
