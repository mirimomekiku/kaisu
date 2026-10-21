import { describe, expect, it } from "vitest";
import { queuePositions, reorderWaiting } from "./queueOrder";

const q = (id: string, status = "queued") => ({ id, status });
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id).join(",");

describe("queuePositions", () => {
  it("numbers the waiting downloads from the oldest, which starts first", () => {
    // newest first: d is the newest, a the oldest
    const items = [q("d"), q("c", "downloading"), q("b"), q("x", "completed"), q("a")];
    const p = queuePositions(items);
    expect([p.get("a"), p.get("b"), p.get("d")]).toEqual([1, 2, 3]);
    expect(p.has("c") || p.has("x")).toBe(false);
  });
});

describe("reorderWaiting", () => {
  it("moves a waiting download into another's place and shifts the ones between", () => {
    const items = [q("d"), q("c"), q("b"), q("a")];
    expect(ids(reorderWaiting(items, "a", "d"))).toBe("a,d,c,b");
    expect(ids(reorderWaiting(items, "d", "a"))).toBe("c,b,a,d");
    expect(ids(reorderWaiting(items, "c", "b"))).toBe("d,b,c,a");
  });

  it("leaves running and finished downloads exactly where they are", () => {
    const items = [q("e"), q("run", "downloading"), q("d"), q("done", "completed"), q("c"), q("paused", "paused"), q("b")];
    const out = reorderWaiting(items, "b", "e");
    expect(ids(out)).toBe("b,run,e,done,d,paused,c");
    expect(out[1].id).toBe("run");
    expect(out[3].id).toBe("done");
    expect(out[5].id).toBe("paused");
  });

  it("changes nothing for an unknown id, the same id, or a download that isn't waiting", () => {
    const items = [q("c"), q("b", "paused"), q("a")];
    expect(reorderWaiting(items, "a", "a")).toBe(items);
    expect(reorderWaiting(items, "nope", "a")).toBe(items);
    expect(reorderWaiting(items, "a", "b")).toBe(items);
    expect(reorderWaiting(items, "b", "a")).toBe(items);
  });

  it("does not modify the list it was given", () => {
    const items = [q("c"), q("b"), q("a")];
    const copy = items.slice();
    reorderWaiting(items, "a", "c");
    expect(items).toEqual(copy);
  });
});
