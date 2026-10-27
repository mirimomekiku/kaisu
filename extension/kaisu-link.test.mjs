import test from "node:test";
import assert from "node:assert/strict";
import { kaisuLinks, sendable, MAX_URLS_PER_LINK, MAX_LINK_LENGTH } from "./kaisu-link.js";

test("only plain web addresses are sent", () => {
  assert.deepEqual(sendable(["https://a.example/x", "http://b.example/", "https://a.example/x", "chrome://settings", "file:///c:/x", "javascript:alert(1)", "https://u:p@c.example/", "nonsense", "about:blank"]), ["https://a.example/x", "http://b.example/"]);
});
test("a link carries encoded addresses", () => {
  assert.deepEqual(kaisuLinks(["https://youtu.be/abc?t=5&x=1"]), ["kaisu://add?url=https%3A%2F%2Fyoutu.be%2Fabc%3Ft%3D5%26x%3D1"]);
  assert.deepEqual(kaisuLinks(["chrome://x"]), []);
});
test("many addresses are split into bounded links", () => {
  const urls = Array.from({ length: 45 }, (_, i) => `https://a.example/${i}`);
  const links = kaisuLinks(urls);
  assert.equal(links.length, 3);
  assert.ok(links.every((l) => l.split("&url=").length <= MAX_URLS_PER_LINK && l.length <= MAX_LINK_LENGTH));
  assert.equal(links.join("").split("url=").length - 1, 45);
});
test("long addresses never produce an oversized link", () => {
  const long = (n) => `https://a.example/${"q".repeat(n)}`;
  const links = kaisuLinks([long(2000), long(2001), long(2002), long(9000)]);
  assert.ok(links.length >= 2 && links.every((l) => l.length <= MAX_LINK_LENGTH));
  assert.ok(!links.join("").includes("q".repeat(9000)));
});
