import { describe, expect, it } from "vitest";
import { historyToCsv, historyToJson, sortHistory, type HistoryRow } from "./history";
import type { HistoryItem } from "./storage";

const row = (over: Partial<HistoryItem> = {}, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  item: { id: "1", url: "https://youtu.be/a", title: "Alpha", thumbnail: "", preset: "best", path: "/d/a.mp4", timestamp: 1000, channel: "Zed", ...over },
  exists: true,
  size: 100,
  ...extra,
});

describe("sortHistory", () => {
  const rows = [row({ id: "a", title: "banana", timestamp: 1, channel: "Y" }, { size: 5 }), row({ id: "b", title: "Apple", timestamp: 3, channel: "x" }, { size: 50 }), row({ id: "c", title: "cherry", timestamp: 2, preset: "audio" }, { size: undefined })];
  const ids = (r: HistoryRow[]) => r.map((x) => x.item.id).join("");

  it("by date, newest first when descending", () => {
    expect(ids(sortHistory(rows, "date", true))).toBe("bca");
    expect(ids(sortHistory(rows, "date", false))).toBe("acb");
  });
  it("by title ignoring case", () => {
    expect(ids(sortHistory(rows, "title", false))).toBe("bac");
  });
  it("by channel ignoring case", () => {
    expect(ids(sortHistory(rows, "channel", false))).toBe("bac"); // x, Y, Zed
    expect(ids(sortHistory(rows, "channel", true))).toBe("cab");
  });
  it("items without a channel sort as empty (first when ascending)", () => {
    const withGap = [row({ id: "p", channel: "Beta" }), row({ id: "q", channel: undefined })];
    expect(ids(sortHistory(withGap, "channel", false))).toBe("qp");
  });
  it("by size, unknown sizes count as smallest", () => {
    expect(ids(sortHistory(rows, "size", true))).toBe("bac");
    expect(ids(sortHistory(rows, "size", false))).toBe("cab");
  });
  it("does not change the original array", () => {
    const before = ids(rows);
    sortHistory(rows, "title", true);
    expect(ids(rows)).toBe(before);
  });
});

describe("historyToCsv", () => {
  it("has a header and one line per row", () => {
    const lines = historyToCsv([row(), row({ id: "2" })]).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Title,Channel,Format,Clip,Downloaded,Size (bytes),File,Link");
  });
  it("quotes commas, quotes and newlines", () => {
    const csv = historyToCsv([row({ title: 'He said "hi", twice\nbye' })]);
    expect(csv).toContain('"He said ""hi"", twice\nbye"');
  });
  it("defuses spreadsheet formulas in titles", () => {
    const csv = historyToCsv([row({ title: "=HYPERLINK(\"http://evil\")" }), row({ title: "+1+1" }), row({ title: "@SUM(A1)" }), row({ title: "-2+3" })]);
    for (const line of csv.trim().split("\r\n").slice(1)) expect(line.startsWith("'") || line.startsWith("\"'")).toBe(true);
  });
  it("leaves out the file path when the file is gone, and labels clips", () => {
    const csv = historyToCsv([row({ clip: "80-165" }, { exists: false })]);
    expect(csv).toContain("1:20 to 2:45");
    expect(csv).not.toContain("/d/a.mp4");
  });
});

describe("historyToJson", () => {
  it("is valid JSON with readable fields", () => {
    const parsed = JSON.parse(historyToJson([row({ clip: "80-165" }), row({ channel: undefined }, { size: undefined, exists: undefined })]));
    expect(parsed[0]).toMatchObject({ title: "Alpha", channel: "Zed", format: "Best quality (MP4)", clip: "1:20 to 2:45", sizeBytes: 100, fileExists: true });
    expect(parsed[1]).toMatchObject({ channel: null, sizeBytes: null, fileExists: null });
  });
});
