import { describe, expect, it } from "vitest";
import { lineAt, parseLrc } from "./lrc";

describe("parseLrc", () => {
  it("reads the time and words of each line", () => {
    expect(parseLrc("[00:12.50] First line\n[01:05.10] Second line")).toEqual([
      { time: 12.5, text: "First line" },
      { time: 65.1, text: "Second line" },
    ]);
  });

  it("understands the different ways of writing the fraction", () => {
    const [a, b, c, d] = parseLrc("[00:01]one\n[00:02.5]two\n[00:03.25]three\n[00:04:125]four");
    expect([a.time, b.time, c.time, d.time]).toEqual([1, 2.5, 3.25, 4.125]);
  });

  it("gives a line that repeats an entry for each time", () => {
    expect(parseLrc("[00:10.00][01:30.00]Chorus")).toEqual([
      { time: 10, text: "Chorus" },
      { time: 90, text: "Chorus" },
    ]);
  });

  it("puts lines in time order even when the file isn't", () => {
    expect(parseLrc("[00:30.00]b\n[00:10.00]a").map((l) => l.text)).toEqual(["a", "b"]);
  });

  it("leaves out titles and lines with no time", () => {
    const lines = parseLrc("[ti:A song]\n[ar:Someone]\n[by:me]\nJust a note\n[00:05.00]Sung");
    expect(lines).toEqual([{ time: 5, text: "Sung" }]);
  });

  it("keeps an empty line, which marks a pause", () => {
    expect(parseLrc("[00:05.00]Words\n[00:09.00]")).toEqual([
      { time: 5, text: "Words" },
      { time: 9, text: "" },
    ]);
  });

  it("applies an offset, and never goes before the start", () => {
    expect(parseLrc("[offset:+500]\n[00:10.00]x\n[00:00.20]y")).toEqual([
      { time: 0, text: "y" },
      { time: 9.5, text: "x" },
    ]);
    expect(parseLrc("[offset:-1000]\n[00:10.00]x")[0].time).toBe(11);
  });

  it("copes with Windows line endings, a byte-order mark and nothing at all", () => {
    expect(parseLrc("﻿[00:01.00]a\r\n[00:02.00]b\r\n").map((l) => l.text)).toEqual(["a", "b"]);
    expect(parseLrc("")).toEqual([]);
  });
});

describe("lineAt", () => {
  const lines = parseLrc("[00:10.00]a\n[00:20.00]b\n[00:30.00]c");
  it("finds the line being sung", () => {
    expect(lineAt(lines, 10)).toBe(0);
    expect(lineAt(lines, 19.99)).toBe(0);
    expect(lineAt(lines, 20)).toBe(1);
    expect(lineAt(lines, 999)).toBe(2);
  });
  it("says none before the first line, or with no lines", () => {
    expect(lineAt(lines, 9.99)).toBe(-1);
    expect(lineAt([], 5)).toBe(-1);
  });
  it("copes with a long song", () => {
    const long = Array.from({ length: 2000 }, (_, i) => ({ time: i * 2, text: String(i) }));
    expect(lineAt(long, 1001)).toBe(500);
  });
});
