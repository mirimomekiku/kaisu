import { describe, expect, it } from "vitest";
import { levelGain, MAX_CUT_DB, unmeasured } from "./loudness";

describe("levelGain", () => {
  it("turns loud songs down to the target", () => {
    expect(levelGain(-10, true)).toBe(-6);
    expect(levelGain(-12.5, true)).toBeCloseTo(-3.5);
  });
  it("never boosts quiet songs", () => {
    expect(levelGain(-16, true)).toBeCloseTo(0);
    expect(levelGain(-23, true)).toBeCloseTo(0);
  });
  it("does nothing when off or when the song isn't measured", () => {
    expect(levelGain(-5, false)).toBe(0);
    expect(levelGain(null, true)).toBe(0);
    expect(levelGain(undefined, true)).toBe(0);
    expect(levelGain(Number.NaN, true)).toBe(0);
  });
  it("limits how much it cuts", () => {
    expect(levelGain(8, true)).toBe(-MAX_CUT_DB);
  });
});

describe("unmeasured", () => {
  it("lists the songs without a measurement", () => {
    expect(unmeasured([{ path: "/a", loudness: -9 }, { path: "/b", loudness: null }])).toEqual(["/b"]);
  });
});
