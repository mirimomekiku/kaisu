import { describe, expect, it } from "vitest";
import { failedGroups } from "./failedDownloads";

const item = (id: string, status: string, playlist: string | null, errorMsg?: string) => ({ id, status, errorMsg, extra: { playlist: playlist ? { title: playlist, index: 1, total: 5 } : null } }) as never;

describe("failedGroups", () => {
  it("groups failures by playlist, largest first, ignoring everything that did not fail", () => {
    const groups = failedGroups([
      item("a", "error", "Mix", "HTTP 403"), item("b", "error", "Mix", "HTTP 403"), item("c", "error", "Mix", "Video unavailable"),
      item("d", "error", null, "Timed out"), item("e", "completed", "Mix"), item("f", "cancelled", "Mix"), item("g", "queued", "Other"),
    ]);
    expect(groups.map((g) => [g.title, g.ids])).toEqual([["Mix", ["a", "b", "c"]], ["Single downloads", ["d"]]]);
    expect(groups[0].reason).toBe("HTTP 403");
  });
  it("reports the first line only, shortened, and a fallback when there is no message", () => {
    const [g] = failedGroups([item("a", "error", null, `${"x".repeat(300)}\nstack`)]);
    expect(g.reason).toHaveLength(160);
    expect(failedGroups([item("b", "error", null)])[0].reason).toBe("No reason was reported");
  });
  it("is empty when nothing failed", () => expect(failedGroups([item("a", "completed", null)])).toEqual([]));
});
