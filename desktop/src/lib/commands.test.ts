import { describe, expect, it } from "vitest";
import { rankCommands, type Command } from "./commands";

const cmd = (id: string, title: string, group = "General", keywords = ""): Command => ({ id, title, group, keywords, run: () => {} });
const list = [
  cmd("search", "Go to Search", "Go to"), cmd("downloads", "Go to Downloads", "Go to"), cmd("pause", "Pause all downloads", "Downloads", "stop"),
  cmd("folders", "Music folders", "Library", "import add watch"), cmd("sync", "Portable collection sync", "Library", "phone usb device"),
  cmd("shortcuts", "Show keyboard shortcuts", "Help", "keys help"),
];
const ids = (query: string) => rankCommands(list, query).map((c) => c.id);

describe("rankCommands", () => {
  it("lists everything, in order, for an empty query", () => expect(ids("  ")).toEqual(list.map((c) => c.id)));
  it("requires every typed word", () => {
    expect(ids("go down")).toEqual(["downloads"]);
    expect(ids("zzz")).toEqual([]);
  });
  it("ranks a title that starts with the query first", () => expect(ids("pau")[0]).toBe("pause"));
  it("prefers title words over group and keyword matches", () => {
    expect(ids("downloads")).toEqual(["downloads", "pause"]);
  });
  it("finds a command by its keywords", () => {
    expect(ids("usb")).toEqual(["sync"]);
    expect(ids("stop")).toEqual(["pause"]);
  });
  it("ignores case and punctuation", () => expect(ids("KEYBOARD, shortcuts!")).toEqual(["shortcuts"]));
});
