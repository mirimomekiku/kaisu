import { describe, expect, it } from "vitest";
import { insertAfter, moveItem, removeAt, shuffleAround, shuffled, unshuffle } from "./playQueue";

const q = ["a", "b", "c", "d", "e"];

describe("insertAfter", () => {
  it("puts items right after the playing one", () => {
    expect(insertAfter(q, 1, ["x", "y"])).toEqual(["a", "b", "x", "y", "c", "d", "e"]);
    expect(insertAfter(q, 4, ["x"])).toEqual(["a", "b", "c", "d", "e", "x"]);
  });
  it("starts the queue when nothing is playing", () => {
    expect(insertAfter([], -1, ["x"])).toEqual(["x"]);
    expect(insertAfter(q, -1, ["x"])).toEqual(["x", "a", "b", "c", "d", "e"]);
  });
  it("leaves the original alone", () => {
    const copy = q.slice();
    insertAfter(q, 0, ["x"]);
    expect(q).toEqual(copy);
  });
});

describe("moveItem", () => {
  it("moves an item and shifts the ones between", () => {
    expect(moveItem(q, 0, 3, 1).queue).toEqual(["a", "d", "b", "c", "e"]);
    expect(moveItem(q, 0, 1, 3).queue).toEqual(["a", "c", "d", "b", "e"]);
  });
  it("keeps following the playing item", () => {
    expect(moveItem(q, 2, 2, 4)).toEqual({ queue: ["a", "b", "d", "e", "c"], current: 4 });
    expect(moveItem(q, 2, 0, 3).current).toBe(1);
    expect(moveItem(q, 2, 4, 0).current).toBe(3);
    expect(moveItem(q, 2, 0, 1).current).toBe(2);
    expect(moveItem(q, 2, 4, 3).current).toBe(2);
  });
  it("ignores impossible moves", () => {
    expect(moveItem(q, 1, 2, 2)).toEqual({ queue: q, current: 1 });
    expect(moveItem(q, 1, -1, 2)).toEqual({ queue: q, current: 1 });
    expect(moveItem(q, 1, 1, 9)).toEqual({ queue: q, current: 1 });
  });
});

describe("removeAt", () => {
  it("follows the playing item when something before it goes", () => {
    expect(removeAt(q, 3, 1)).toEqual({ queue: ["a", "c", "d", "e"], current: 2, removedCurrent: false });
  });
  it("leaves the position when something after it goes", () => {
    expect(removeAt(q, 1, 3)).toEqual({ queue: ["a", "b", "c", "e"], current: 1, removedCurrent: false });
  });
  it("moves on to the next item when the playing one goes, or the last one at the end", () => {
    expect(removeAt(q, 2, 2)).toEqual({ queue: ["a", "b", "d", "e"], current: 2, removedCurrent: true });
    expect(removeAt(q, 4, 4)).toEqual({ queue: ["a", "b", "c", "d"], current: 3, removedCurrent: true });
    expect(removeAt(["a"], 0, 0)).toEqual({ queue: [], current: -1, removedCurrent: true });
  });
  it("ignores a position that isn't there", () => {
    expect(removeAt(q, 1, 9).queue).toBe(q);
  });
});

describe("shuffling", () => {
  const seq = (...n: number[]) => {
    let i = 0;
    return () => n[i++ % n.length];
  };
  it("is a permutation, reproducible with a fixed random source", () => {
    const out = shuffled(q, seq(0, 0, 0, 0));
    expect(out.slice().sort()).toEqual(q);
    expect(shuffled(q, seq(0, 0, 0, 0))).toEqual(out);
    expect(shuffled([], seq(0))).toEqual([]);
  });
  it("keeps the playing item first", () => {
    const { queue, current } = shuffleAround(q, 2, seq(0.9, 0.1, 0.5));
    expect(queue[0]).toBe("c");
    expect(current).toBe(0);
    expect(queue.slice().sort()).toEqual(q);
  });
  it("can be undone, keeping the playing item and anything added since", () => {
    const { queue } = shuffleAround(q, 2, seq(0.3, 0.7, 0.1));
    const withNew = [...queue, "z"];
    const back = unshuffle(withNew, 0, q);
    expect(back.queue).toEqual(["a", "b", "c", "d", "e", "z"]);
    expect(back.current).toBe(2);
  });
  it("forgets what was removed while shuffled", () => {
    const { queue } = shuffleAround(q, 0, seq(0.5));
    const trimmed = queue.filter((t) => t !== "d");
    expect(unshuffle(trimmed, 0, q).queue).toEqual(["a", "b", "c", "e"]);
  });
});
