import { describe, expect, it } from "vitest";
import { editWaitingDownloads } from "./queueEdit";
import type { DownloadItem } from "../hooks/useDownloads";

const item = (id: string, status: DownloadItem["status"]): DownloadItem => ({ id, status, preset: "best", outDir: "/old", extra: { format_id: "137+140", rate_limit: "1M", audio_format: "mp3", proxy: null, output: { layout: "music" } } } as DownloadItem);
describe("bulk waiting download edits", () => {
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
