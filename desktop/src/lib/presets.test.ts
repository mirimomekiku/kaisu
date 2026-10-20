import { describe, expect, it } from "vitest";
import { checkPresetName, sanitizePresets, type FormatPreset } from "./presets";

const preset = (name: string): FormatPreset => ({ id: name, name, kind: "audio", quality: "best", subMode: "off", subLangs: "en", audioQuality: "192K", normalize: true, trimSilence: false, cover: "square", lyrics: "file" });

describe("presets", () => {
  it("validates names", () => {
    expect(checkPresetName("", [])).not.toBeNull();
    expect(checkPresetName("x".repeat(41), [])).not.toBeNull();
    expect(checkPresetName("Podcast", [preset("podcast")])).not.toBeNull();
    expect(checkPresetName("Podcast", [])).toBeNull();
    expect(checkPresetName("New", Array.from({ length: 20 }, (_, i) => preset(`p${i}`)))).not.toBeNull();
  });

  it("repairs saved data", () => {
    expect(sanitizePresets("nope")).toEqual([]);
    expect(sanitizePresets([{ id: "1", name: "A", kind: "weird", quality: "bad", cover: "custom", lyrics: "x", subMode: "y" }, null, 5])).toEqual([
      { id: "1", name: "A", kind: "video", quality: "best", subMode: "off", subLangs: "en", audioQuality: "", normalize: false, trimSilence: false, cover: "default", lyrics: "off" },
    ]);
    expect(sanitizePresets([preset("ok")])[0].cover).toBe("square");
  });
});
