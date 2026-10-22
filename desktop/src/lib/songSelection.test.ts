import { describe, expect, it } from "vitest";
import { emptySelection, pruneSelection, selectSong } from "./songSelection";

const order = ["a", "b", "c", "d", "e"];
const selected = (paths: string[], anchor = paths[0] ?? null) => ({ paths: new Set(paths), anchor });
const paths = (state: ReturnType<typeof emptySelection>) => [...state.paths];

describe("song selection", () => {
  it("replaces the selection on a plain row click without mutating it", () => {
    const before = selected(["a", "c"]);
    const after = selectSong(before, order, "b");
    expect(paths(after)).toEqual(["b"]);
    expect(after.anchor).toBe("b");
    expect(paths(before)).toEqual(["a", "c"]);
  });
  it("toggles individual songs additively for checkboxes and Ctrl/Command clicks", () => {
    let state = selectSong(selected(["a"]), order, "c", { toggle: true });
    expect(paths(state)).toEqual(["a", "c"]);
    state = selectSong(state, order, "a", { toggle: true });
    expect(paths(state)).toEqual(["c"]);
    expect(state.anchor).toBe("a");
  });
  it("extends and contracts a range around a stable anchor in either direction", () => {
    let state = selectSong(selected(["b"]), order, "e", { range: true });
    expect(paths(state)).toEqual(["b", "c", "d", "e"]);
    state = selectSong(state, order, "c", { range: true });
    expect(paths(state)).toEqual(["b", "c"]);
    state = selectSong(state, order, "a", { range: true });
    expect(paths(state)).toEqual(["a", "b"]);
    expect(state.anchor).toBe("b");
  });
  it("adds a range to unrelated selections when requested", () => {
    expect(paths(selectSong(selected(["a", "c"], "c"), order, "e", { range: true, additive: true }))).toEqual(["a", "c", "d", "e"]);
  });
  it("uses the current sort order and follows paths instead of old row indexes", () => {
    const state = selectSong(selected(["b", "e"], "b"), ["e", "d", "c", "b", "a"], "d", { range: true });
    expect(paths(state)).toEqual(["d", "c", "b"]);
  });
  it("selects ranges beyond the rendered viewport", () => {
    const all = Array.from({ length: 1000 }, (_, i) => `song-${i}`);
    const state = selectSong(selected([all[5]]), all, all[999], { range: true });
    expect(state.paths.size).toBe(995);
    expect(state.paths.has(all[500])).toBe(true);
  });
  it("prunes hidden or removed paths and anchors so they cannot reappear later", () => {
    const state = pruneSelection(selected(["a", "c"], "a"), new Set(["b", "c"]));
    expect(paths(state)).toEqual(["c"]);
    expect(state.anchor).toBeNull();
    expect(pruneSelection(state, new Set(order))).toBe(state);
    expect(paths(selectSong(state, order, "e", { range: true }))).toEqual(["e"]);
  });
  it("ignores a song that is no longer in the current list", () => {
    const state = selected(["a"]);
    expect(selectSong(state, order, "removed", { toggle: true })).toBe(state);
  });
});
