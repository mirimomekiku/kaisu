import { describe, expect, it } from "vitest";
import { sessionPlayer, sanitizeSessions, relocateSessions } from "./listeningSessions";
const player = { queue: [{ path: "/a.mp3", title: "A", cover: "blob:temporary" }, { path: "/b.mp3", title: "B" }], index: 1, position: 23, rate: 1, volume: .5, repeat: "off" as const, shuffle: false };
describe("listening session snapshots", () => {
  it("preserves duplicate occurrences and resume state without temporary artwork", () => {
    const result = sessionPlayer({ ...player, queue: [player.queue[0], player.queue[0]], index: 1 })!;
    expect(result.player.queue).toHaveLength(2); expect(result.player.queue[0].cover).toBeUndefined();
    expect(result.player).toMatchObject({ index: 1, position: 23 });
  });
  it("bounds large queues around the actual current track", () => {
    const queue = Array.from({ length: 3000 }, (_, i) => ({ path: `/${i}.mp3`, title: `${i}` }));
    const result = sessionPlayer({ ...player, queue, index: 2700 })!;
    expect(result.player.queue).toHaveLength(500); expect(result.player.queue[result.player.index].title).toBe("2700"); expect(result.omitted).toBe(2500);
  });
  it("skips malformed sessions and follows relocated files", () => {
    const sessions = sanitizeSessions([null, {}, { id: "one", name: "Evening", player, started: 1, updated: 2, seconds: 5 }]);
    expect(sessions).toHaveLength(1); expect(relocateSessions(sessions, "/b.mp3", "/moved/b.mp3")[0].player.queue[1].path).toBe("/moved/b.mp3");
    expect(sessions[0].player.queue[1].path).toBe("/b.mp3");
  });
});
