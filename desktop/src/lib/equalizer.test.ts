import { describe, expect, it } from "vitest";
import { defaultEqualizer, EQ_PRESETS, equalizerHeadroom, equalizerPreset, sanitizeEqualizer } from "./equalizer";
import { EqualizerGraph } from "./equalizerGraph";

describe("equalizer settings", () => {
  it("repairs malformed saved settings and bounds every control", () => {
    expect(sanitizeEqualizer(null)).toEqual(defaultEqualizer());
    expect(sanitizeEqualizer({ enabled: "true", preamp: Infinity, bands: [99, -99, NaN, "6", null], autoHeadroom: "no" })).toEqual({ enabled: false, preamp: 0, bands: [12, -12, 0, 0, 0, 0, 0, 0, 0, 0], autoHeadroom: true });
    const a = defaultEqualizer(), b = defaultEqualizer(); a.bands[0] = 10; expect(b.bands[0]).toBe(0);
  });
  it("identifies presets and custom adjustments without sharing saved arrays", () => {
    expect(equalizerPreset(defaultEqualizer())).toBe("Flat");
    expect(equalizerPreset({ ...defaultEqualizer(), bands: [...EQ_PRESETS.Vocals] })).toBe("Vocals");
    expect(equalizerPreset({ ...defaultEqualizer(), preamp: -2 })).toBe("Custom");
  });
  it("accounts for overlapping boosts, bypass and manual preamp", () => {
    const filter = (db: number) => ({ getFrequencyResponse: (_f: Float32Array, magnitude: Float32Array) => magnitude.fill(Math.pow(10, db / 20)) }) as unknown as BiquadFilterNode;
    const settings = { ...defaultEqualizer(), enabled: true, preamp: 2 };
    expect(equalizerHeadroom([filter(4), filter(3)], 48000, settings)).toBeCloseTo(-7);
    expect(equalizerHeadroom([filter(4)], 48000, { ...settings, autoHeadroom: false })).toBe(2);
    expect(equalizerHeadroom([filter(4)], 48000, { ...settings, enabled: false })).toBe(0);
  });
});

it("reports unavailable processing and keeps direct playback usable", async () => {
  const graph = new EqualizerGraph(null);
  graph.configure({ ...defaultEqualizer(), enabled: true }); await graph.activate();
  expect(graph.status()).toMatchObject({ supported: false, active: false });
  await graph.setOutput(""); graph.dispose();
});
