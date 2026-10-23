import { describe, expect, it } from "vitest";
import { pickStartable, resourceGate } from "./queueStart";

const item = (id: string, url: string, status = "queued", retryAt?: number) => ({ id, url, status, retryAt });
const opts = { free: 5, now: 1000, cooldowns: new Map<string, number>(), perSite: 0, started: new Set<string>() };

describe("pickStartable", () => {
  it("starts the oldest queued item first (the list is newest-first)", () => {
    const items = [item("c", "https://a.test/3"), item("b", "https://a.test/2"), item("a", "https://a.test/1")];
    expect(pickStartable(items, { ...opts, free: 2 }).map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("skips items already started, still waiting to retry, or not queued", () => {
    const items = [item("d", "https://a.test/4", "paused"), item("c", "https://a.test/3", "queued", 2000), item("b", "https://a.test/2"), item("a", "https://a.test/1")];
    expect(pickStartable(items, { ...opts, started: new Set(["a"]) }).map((i) => i.id)).toEqual(["b"]);
  });
  it("skips a website in cooldown but not others, and treats youtu.be as YouTube", () => {
    const items = [item("v", "https://vimeo.com/1"), item("y", "https://youtu.be/abcdefghijk")];
    expect(pickStartable(items, { ...opts, cooldowns: new Map([["youtube.com", 5000]]) }).map((i) => i.id)).toEqual(["v"]);
    expect(pickStartable(items, { ...opts, cooldowns: new Map([["youtube.com", 500]]) })).toHaveLength(2);
  });
  it("counts running downloads against the per-site limit", () => {
    const items = [item("b", "https://a.test/2"), item("a", "https://a.test/1", "downloading"), item("o", "https://b.test/1")];
    expect(pickStartable(items, { ...opts, perSite: 1 }).map((i) => i.id)).toEqual(["o"]);
    expect(pickStartable(items, { ...opts, perSite: 2 }).map((i) => i.id)).toEqual(["o", "b"]);
  });
});

describe("resourceGate", () => {
  const steady = { key: "a", draining: false };
  it("lets the queue start while the budget is unchanged", () => {
    expect(resourceGate(steady, "a", 2)).toEqual({ gate: steady, canStart: true });
  });
  it("holds new starts while running transfers stop after a budget change, then releases", () => {
    const changed = resourceGate(steady, "b", 2);
    expect(changed).toEqual({ gate: { key: "b", draining: true }, canStart: false });
    expect(resourceGate(changed.gate, "b", 1).canStart).toBe(false);
    expect(resourceGate(changed.gate, "b", 0)).toEqual({ gate: { key: "b", draining: false }, canStart: true });
  });
  it("starts at once when a budget change finds nothing running", () => {
    expect(resourceGate(steady, "b", 0)).toEqual({ gate: { key: "b", draining: false }, canStart: true });
  });
  it("restarts the drain when the budget changes again before the first drain ends", () => {
    const first = resourceGate(steady, "b", 2);
    expect(resourceGate(first.gate, "c", 1)).toEqual({ gate: { key: "c", draining: true }, canStart: false });
  });
});
