import { describe, expect, it } from "vitest";
import { visibleRange } from "./useVirtualRows";

describe("visibleRange", () => {
  it("draws the rows on screen plus a few either side", () => {
    // 28px rows, a 280px view: rows 0-9 are visible.
    expect(visibleRange(0, 280, 28, 1000, 0)).toEqual({ start: 0, end: 10 });
    expect(visibleRange(0, 280, 28, 1000, 8)).toEqual({ start: 0, end: 18 });
    expect(visibleRange(2800, 280, 28, 1000, 8)).toEqual({ start: 92, end: 118 });
  });

  it("never goes past either end of the list", () => {
    expect(visibleRange(-50, 280, 28, 1000, 8).start).toBe(0);
    expect(visibleRange(99_999, 280, 28, 1000, 8).end).toBe(1000);
    expect(visibleRange(0, 280, 28, 4, 8)).toEqual({ start: 0, end: 4 });
  });

  it("draws nothing for an empty list or a bad row height", () => {
    expect(visibleRange(0, 280, 28, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, 280, 0, 100)).toEqual({ start: 0, end: 0 });
  });

  it("only ever draws a small window of a huge list", () => {
    const { start, end } = visibleRange(140_000, 700, 28, 100_000, 8);
    expect(end - start).toBeLessThan(60);
  });
});
