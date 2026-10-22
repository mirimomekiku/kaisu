import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, saves: 0, failSave: false }));
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => state.data[key],
  set: async (key: string, value: unknown) => { state.data[key] = value; },
  save: async () => { if (state.failSave) throw new Error("disk unavailable"); state.saves++; },
}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (p: string) => p, Channel: class {} }));

import { loadQueue, queueWithoutProxy, saveQueue, type SavedDownload } from "./storage";
import { setProxy, startDownload, type DownloadRequest } from "./api";

const entry = (): SavedDownload => ({ id: "a", title: "Song", url: "https://example.com/song", thumbnail: "", preset: "audio", outDir: "/music", status: "paused", progress: 25,
  extra: { proxy: "socks5://user:secret@old:1080", audio_format: "flac", rate_limit: "2M" } as SavedDownload["extra"] });

beforeEach(() => { state.data = {}; state.saves = 0; state.failSave = false; invoke.mockClear(); setProxy(""); });

describe("download queue credentials", () => {
  it("scrubs proxies without changing the download's choices or its in-memory source", async () => {
    const source = entry();
    await saveQueue([source]);
    expect(JSON.stringify(state.data)).not.toContain("secret");
    expect(queueWithoutProxy([source])[0].extra).toEqual({ proxy: null, audio_format: "flac", rate_limit: "2M" });
    expect(source.extra.proxy).toContain("secret");
  });

  it("rewrites legacy queues and flushes the migration before returning", async () => {
    state.data.queue = [entry()];
    const restored = await loadQueue();
    expect(restored[0]).toMatchObject({ status: "paused", progress: 25, extra: { proxy: null } });
    expect(JSON.stringify(state.data)).not.toContain("secret");
    expect(state.saves).toBe(1);
    await loadQueue();
    expect(state.saves).toBe(1);
  });

  it("keeps the scrubbed queue in memory when its migration cannot be flushed", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.data.queue = [entry()]; state.failSave = true;
    expect(await loadQueue()).toHaveLength(1);
    expect((await loadQueue())[0].extra.proxy).toBeNull();
    warning.mockRestore();
  });

  it("uses current network settings each time a restored or queued download starts", async () => {
    const saved = entry();
    const req: DownloadRequest = { id: saved.id, url: saved.url, preset: saved.preset, out_dir: saved.outDir, extra: saved.extra };
    setProxy("http://current:new-password@proxy:8080");
    await startDownload(req, () => {});
    expect(invoke.mock.calls[invoke.mock.calls.length - 1]?.[1].req.extra.proxy).toBe("http://current:new-password@proxy:8080");
    setProxy("");
    await startDownload(req, () => {});
    expect(invoke.mock.calls[invoke.mock.calls.length - 1]?.[1].req.extra.proxy).toBeNull();
    expect(req.extra.proxy).toContain("old");
  });
});
