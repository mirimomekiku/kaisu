import { describe, expect, it } from "vitest";
import { createImageLoader } from "./imageLoader";

const bytes = () => new Uint8Array([1, 2, 3]).buffer;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createImageLoader", () => {
  it("fetches once however many ask, then answers from memory", async () => {
    let fetches = 0;
    const loader = createImageLoader(async () => (fetches++, bytes()));
    const [a, b] = await Promise.all([loader.load("x"), loader.load("x")]);
    expect(a).toMatch(/^blob:/);
    expect(b).toBe(a);
    expect(await loader.load("x")).toBe(a);
    expect(loader.peek("x")).toBe(a);
    expect(fetches).toBe(1);
    expect(loader.peek("never asked")).toBeUndefined();
  });

  it("doesn't fetch what is already an address the page can show", async () => {
    let fetches = 0;
    const loader = createImageLoader(async () => (fetches++, bytes()), { isLocal: (k) => k.startsWith("data:") });
    expect(loader.peek("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(await loader.load("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(fetches).toBe(0);
  });

  it("keeps only a few requests in flight at once", async () => {
    let open = 0;
    let most = 0;
    const releases: Array<() => void> = [];
    const loader = createImageLoader(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          open++;
          most = Math.max(most, open);
          releases.push(() => {
            open--;
            resolve(bytes());
          });
        }),
      { maxParallel: 2 },
    );
    const all = Promise.all(["a", "b", "c", "d", "e"].map((k) => loader.load(k)));
    await tick();
    expect(open).toBe(2);
    while (releases.length) {
      releases.shift()!();
      await tick();
    }
    await all;
    expect(most).toBe(2);
  });

  it("remembers a failure for a while, then tries again", async () => {
    let clock = 0;
    let fail = true;
    let fetches = 0;
    const loader = createImageLoader(
      async () => {
        fetches++;
        if (fail) throw "no picture";
        return bytes();
      },
      { now: () => clock, retryAfterMs: 1000 },
    );
    expect(await loader.load("k")).toBeNull();
    expect(loader.peek("k")).toBeNull();
    expect(await loader.load("k")).toBeNull();
    expect(fetches).toBe(1);
    clock = 2000;
    fail = false;
    expect(loader.peek("k")).toBeUndefined();
    expect(await loader.load("k")).toMatch(/^blob:/);
    expect(fetches).toBe(2);
  });

  it("drops the least recently used pictures when it holds too many", async () => {
    const loader = createImageLoader(async () => bytes(), { maxCached: 3 });
    for (const k of ["a", "b", "c"]) await loader.load(k);
    loader.peek("a");
    await loader.load("d");
    expect(loader.peek("b")).toBeUndefined();
    expect(loader.peek("a")).toMatch(/^blob:/);
    expect(loader.peek("d")).toMatch(/^blob:/);
  });
});
