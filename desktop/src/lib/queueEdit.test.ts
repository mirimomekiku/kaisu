import { describe, expect, it } from "vitest";
import { editWaitingDownloads } from "./queueEdit";
import type { DownloadItem } from "../hooks/useDownloads";

const item = (id: string, status: DownloadItem["status"]): DownloadItem => ({ id, status, preset: "best", outDir: "/old", extra: { format_id: "137+140", rate_limit: "1M", audio_format: "mp3", proxy: null, output: { layout: "music" } } } as DownloadItem);
describe("bulk waiting download edits", () => {
  it("detaches output-changing edits from their original recovery records", () => {
    for (const edit of [{ preset: "p720" as const }, { audioFormat: "flac" as const }, { outDir: "/new" }]) {
      const original = { ...item("saved", "paused"), recoveryId: "original-recovery", progress: 65, expectedVolume: 42 };
      const [changed] = editWaitingDownloads([original], new Set([original.id]), edit);
      expect(changed.recoveryId).not.toBe(original.recoveryId);
      expect(changed.recoveryId).not.toBe(original.id);
      expect(changed.progress).toBe(0);
      expect(original.recoveryId).toBe("original-recovery");
      expect(original.progress).toBe(65);
      expect(changed.expectedVolume).toBe(edit.outDir ? undefined : 42);
    }
  });
  it("keeps compatible recovery for speed-only and unchanged automatic quality edits", () => {
    const original = { ...item("saved", "paused"), recoveryId: "original-recovery", progress: 65, extra: { ...item("saved", "paused").extra, format_id: null } };
    for (const edit of [{ rateLimit: "500K" }, { preset: "best" as const }, { outDir: "/old" }]) {
      const [changed] = editWaitingDownloads([original], new Set([original.id]), edit);
      expect(changed.recoveryId).toBe(original.recoveryId);
      expect(changed.progress).toBe(65);
    }
  });
  it("changes only selected waiting items and preserves unrelated options", () => {
    const items = [item("a", "queued"), item("b", "paused"), item("c", "downloading"), item("d", "processing"), item("e", "completed"), item("f", "queued")];
    const changed = editWaitingDownloads(items, new Set(["a", "b", "c", "d", "e"]), { preset: "audio", audioFormat: "flac", outDir: " /new ", rateLimit: null });
    expect(changed[0]).toMatchObject({ preset: "audio", outDir: "/new", extra: { audio_format: "flac", format_id: null, rate_limit: null, output: { layout: "music" } } });
    expect(changed[1].status).toBe("paused");
    for (let i = 2; i < items.length; i++) expect(changed[i]).toBe(items[i]);
    expect(items[0].extra.format_id).toBe("137+140");
  });
  it("skips items claimed by the scheduler and does not clear unspecified fields", () => {
    const items = [item("a", "queued"), item("b", "paused")];
    const changed = editWaitingDownloads(items, new Set(["a", "b"]), { rateLimit: "500K" }, new Set(["a"]));
    expect(changed[0]).toBe(items[0]);
    expect(changed[1]).toMatchObject({ preset: "best", outDir: "/old", extra: { format_id: "137+140", rate_limit: "500K" } });
  });
});
