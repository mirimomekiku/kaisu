import { describe, expect, it } from "vitest";
import { relocateListening, relocatePlaylists, relocatePositions, relocateTrack } from "./relocation";
import { relocatePreference } from "./musicPreferences";
import type { Listening } from "./listening";

describe("track relocation", () => {
  it("merges listening totals exactly once when retried", () => {
    const stats = { old: { plays: 2, seconds: 10, lastPlayed: 40 }, next: { plays: 3, seconds: 20, lastPlayed: 30 } };
    const moved = relocateListening(stats, "old", "next");
    expect(moved).toEqual({ next: { plays: 5, seconds: 30, lastPlayed: 40 } });
    expect(relocateListening(moved, "old", "next")).toBe(moved);
  });

  it("preserves playlist order, avoids duplicate destinations and leaves smart rules intact", () => {
    const manual = { id: "a", name: "Songs", updated: 1, paths: ["first", "old", "next", "last"] };
    const smart = { ...manual, id: "b", smart: { match: "all" as const, rules: [] } };
    const moved = relocatePlaylists([manual, smart], "old", "next");
    expect(moved[0].paths).toEqual(["first", "next", "last"]);
    expect(moved[1]).toBe(smart);
  });

  it("keeps the newest resume position and merges favorite/rating collisions", () => {
    const positions = { old: { t: 60, d: 900, at: 10 }, next: { t: 120, d: 900, at: 20 } };
    expect(relocatePositions(positions, "old", "next")).toEqual({ next: positions.next });
    expect(relocatePositions(positions, "old", "old")).toBe(positions);
    expect(relocatePreference({ old: { favorite: true, rating: 2 }, next: { favorite: false, rating: 5 } }, "old", "next")).toEqual({ next: { favorite: true, rating: 5 } });
  });

  it("flushes the player's final listening time before moving all records", () => {
    let stats: Listening = { old: { plays: 1, seconds: 5, lastPlayed: 1 } };
    const updated: string[] = [];
    relocateTrack({
      player: { replacePath: () => { stats.old.seconds = 8; updated.push("player"); } },
      listening: { relocate: (from, to) => { stats = relocateListening(stats, from, to); updated.push("listening"); } },
      preferences: { relocate: () => { updated.push("preferences"); } },
      playlists: { relocate: () => { updated.push("playlists"); } },
      history: () => { updated.push("history"); },
    }, "old", "next");
    expect(stats.next.seconds).toBe(8);
    expect(updated).toEqual(["player", "listening", "preferences", "playlists", "history"]);
  });
});
