import { describe, expect, it } from "vitest";
import { forget, REMEMBER_FROM_SECONDS, remember, resumeAt, sanitizePositions, type Positions } from "./positions";

const LONG = REMEMBER_FROM_SECONDS * 3;

describe("remember", () => {
  it("keeps where a long file stopped", () => {
    const p = remember({}, "/a.mp3", 900.7, LONG, 1000);
    expect(p["/a.mp3"]).toEqual({ t: 900, d: LONG, at: 1000 });
    expect(resumeAt(p, "/a.mp3")).toBe(900);
  });

  it("doesn't keep songs, the first seconds, or the end", () => {
    expect(remember({}, "/song.mp3", 100, 200)).toEqual({});
    expect(remember({}, "/a.mp3", 2, LONG)).toEqual({});
    expect(remember({}, "/a.mp3", LONG - 5, LONG)).toEqual({});
    expect(remember({}, "/a.mp3", NaN, LONG)).toEqual({});
  });

  it("forgets a file once it is finished or restarted", () => {
    const p = remember({}, "/a.mp3", 900, LONG);
    expect(remember(p, "/a.mp3", LONG - 1, LONG)).toEqual({});
    expect(remember(p, "/a.mp3", 0, LONG)).toEqual({});
    expect(forget(p, "/a.mp3")).toEqual({});
    expect(forget(p, "/other.mp3")).toBe(p);
  });

  it("keeps the most recent few hundred", () => {
    let p: Positions = {};
    for (let i = 0; i < 305; i++) p = remember(p, `/f${i}.mp3`, 100, LONG, i);
    expect(Object.keys(p)).toHaveLength(300);
    expect(p["/f0.mp3"]).toBeUndefined();
    expect(p["/f304.mp3"]).toBeDefined();
  });
});

describe("resumeAt", () => {
  it("starts from the top when there is nothing sensible to resume", () => {
    expect(resumeAt({}, "/a.mp3")).toBe(0);
    expect(resumeAt({ "/a.mp3": { t: 2, d: LONG, at: 0 } }, "/a.mp3")).toBe(0);
    expect(resumeAt({ "/a.mp3": { t: LONG - 3, d: LONG, at: 0 } }, "/a.mp3")).toBe(0);
    expect(resumeAt({ "/song.mp3": { t: 100, d: 200, at: 0 } }, "/song.mp3")).toBe(0);
  });
});

describe("sanitizePositions", () => {
  it("keeps only well-formed entries", () => {
    expect(sanitizePositions(null)).toEqual({});
    expect(sanitizePositions("x")).toEqual({});
    expect(sanitizePositions({ "/a": { t: 1, d: 2, at: 3 }, "/b": { t: "x" }, "/c": null })).toEqual({ "/a": { t: 1, d: 2, at: 3 } });
  });
});
