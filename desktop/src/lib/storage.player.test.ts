import { describe, expect, it } from "vitest";
import { sanitizePlayer } from "./storage";

describe("sanitizePlayer", () => {
  const good = { queue: [{ path: "/a.mp3", title: "A", artist: "X", album: "Y", duration: 200 }, { path: "/b.mp3", title: "B" }], index: 1, position: 42.5, volume: 0.4, rate: 1.25, repeat: "all", shuffle: true };

  it("keeps saved player state", () => {
    const p = sanitizePlayer(good)!;
    expect(p.queue).toHaveLength(2);
    expect(p).toMatchObject({ index: 1, position: 42.5, volume: 0.4, rate: 1.25, repeat: "all", shuffle: true });
    expect(p.queue[0]).toEqual({ path: "/a.mp3", title: "A", artist: "X", album: "Y", duration: 200 });
  });

  it("means nothing saved when it isn't shaped right or is empty", () => {
    for (const bad of [null, undefined, 5, "x", {}, { queue: "no" }, { queue: [] }, { queue: [{ title: "no path" }, null, 3] }]) expect(sanitizePlayer(bad)).toBeNull();
  });

  it("repairs numbers that are out of range, and unknown modes", () => {
    const p = sanitizePlayer({ ...good, index: 99, volume: 7, rate: 9, repeat: "sideways", position: -3, shuffle: "yes" })!;
    expect(p).toMatchObject({ index: 1, volume: 1, rate: 2, repeat: "off", position: 0, shuffle: false });
  });

  it("drops entries that aren't tracks and ignores a bad duration", () => {
    const p = sanitizePlayer({ ...good, queue: [{ path: "/a.mp3", title: "A", duration: "long" }, { path: 1, title: "x" }] })!;
    expect(p.queue).toEqual([{ path: "/a.mp3", title: "A", artist: undefined, album: undefined, duration: undefined }]);
  });
});
