import { describe, expect, it } from "vitest";
import { linksFromFile, MAX_FILE_LINKS } from "./linkFile";

describe("linksFromFile", () => {
  it("reads one address per line, ignoring comments and blank lines", () => {
    expect(linksFromFile("# my list\nhttps://youtu.be/a\n\nhttps://vimeo.com/2\n").links).toEqual(["https://youtu.be/a", "https://vimeo.com/2"]);
  });
  it("finds addresses in any CSV column, quoted or not, with a byte-order mark", () => {
    const csv = '\uFEFFtitle,url,notes\nOne,"https://youtu.be/a?t=5",ok\nTwo,https://vimeo.com/2,"see, here"\n';
    expect(linksFromFile(csv).links).toEqual(["https://youtu.be/a?t=5", "https://vimeo.com/2"]);
  });
  it("splits separators that are stuck to an address", () => {
    expect(linksFromFile("https://a.example/x,https://b.example/y;https://c.example/z\thttps://d.example/").links).toHaveLength(4);
  });
  it("drops duplicates and counts them, and ignores other schemes", () => {
    const r = linksFromFile("https://a.example/x\nhttps://a.example/x\nftp://b.example/y\nfile:///c:/z\njavascript:alert(1)");
    expect(r.links).toEqual(["https://a.example/x"]);
    expect([r.found, r.duplicates]).toEqual([2, 1]);
  });
  it("limits one run and says so", () => {
    const text = Array.from({ length: MAX_FILE_LINKS + 20 }, (_, i) => `https://a.example/${i}`).join("\n");
    const r = linksFromFile(text);
    expect(r.links).toHaveLength(MAX_FILE_LINKS);
    expect(r.truncated).toBe(true);
  });
  it("returns nothing for text without links", () => expect(linksFromFile("just words, no links").links).toEqual([]));
});
