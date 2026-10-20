import { describe, expect, it } from "vitest";
import { isInside, normalizePath, oldDownloads, pendingMoves, typeMatches } from "./transfer";
import type { HistoryItem } from "./storage";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const item = (id: string, path: string | null, ageDays: number, preset: HistoryItem["preset"] = "best", extra: Partial<HistoryItem> = {}): HistoryItem => ({
  id,
  url: `https://x/${id}`,
  title: id,
  thumbnail: "",
  preset,
  path,
  timestamp: NOW - ageDays * DAY,
  ...extra,
});

describe("paths", () => {
  it("compares folders sensibly", () => {
    expect(isInside("/home/u/Downloads/a/b.mp3", "/home/u/Downloads")).toBe(true);
    expect(isInside("/home/u/Downloads", "/home/u/Downloads/")).toBe(true);
    expect(isInside("/home/u/Downloads2/a.mp3", "/home/u/Downloads")).toBe(false);
    expect(isInside("/anything", "")).toBe(false);
    expect(isInside("C:\\Users\\U\\Music\\a.mp3", "c:/users/u/music")).toBe(true);
    expect(normalizePath("D:\\Backup\\")).toBe("d:/backup");
  });
});

describe("what to move", () => {
  const dir = "/dl";
  const exists = { "/dl/gone.mp4": false };
  const history = [item("a", "/dl/a.mp4", 1), item("b", "/dl/b.mp3", 1, "audio"), item("c", "/usb/c.mp4", 1), item("d", null, 1), item("e", "/dl/e.mp4", 1, "best", { transferred: "/usb/e.mp4" }), item("f", "/dl/gone.mp4", 1)];

  it("takes only files still in the download folder that haven't been handled", () => {
    expect(pendingMoves(history, dir, "all", exists).map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("can be limited by type", () => {
    expect(pendingMoves(history, dir, "audio", exists).map((h) => h.id)).toEqual(["b"]);
    expect(pendingMoves(history, dir, "video", exists).map((h) => h.id)).toEqual(["a"]);
    expect(typeMatches({ preset: "audio" }, "video")).toBe(false);
  });
});

describe("what to delete", () => {
  const history = [item("old", "/dl/old.mp4", 40), item("new", "/dl/new.mp4", 3), item("usb", "/usb/o.mp4", 90), item("elsewhere", "/other/x.mp4", 90), item("gone", "/dl/g.mp4", 90), item("nopath", null, 90)];
  const exists = { "/dl/g.mp4": false };

  it("is nothing when turned off", () => expect(oldDownloads(history, 0, NOW, ["/dl"], exists)).toEqual([]));

  it("takes old files in the chosen folders only", () => {
    expect(oldDownloads(history, 30, NOW, ["/dl"], exists).map((h) => h.id)).toEqual(["old"]);
    expect(oldDownloads(history, 30, NOW, ["/dl", "/usb"], exists).map((h) => h.id)).toEqual(["old", "usb"]);
    expect(oldDownloads(history, 30, NOW, ["/dl", ""], exists).map((h) => h.id)).toEqual(["old"]);
  });
});
