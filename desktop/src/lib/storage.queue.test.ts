import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, saves: 0, failSave: false }));
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => state.data[key],
  set: async (key: string, value: unknown) => { state.data[key] = value; },
  save: async () => { if (state.failSave) throw new Error("disk unavailable"); state.saves++; },
}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (p: string) => p, Channel: class {} }));

import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadQueue, queueWithoutProxy, saveQueue, saveHistory, loadHistory, persist, type SavedDownload } from "./storage";
import { storageIssues } from "./storageHealth";
import { setProxy, startDownload, type DownloadRequest } from "./api";

const entry = (): SavedDownload => ({ id: "a", title: "Song", url: "https://example.com/song", thumbnail: "", preset: "audio", outDir: "/music", status: "paused", progress: 25,
  extra: { proxy: "socks5://user:secret@old:1080", audio_format: "flac", rate_limit: "2M" } as SavedDownload["extra"] });

beforeEach(() => { state.data = {}; state.saves = 0; state.failSave = false; invoke.mockClear(); setProxy(""); });

describe("download queue credentials", () => {
  it("retains completion records beyond the old display-history limit", async () => {
    const history = Array.from({ length: 650 }, (_, i) => ({ id: `h${i}`, url: `https://example.com/${i}`, title: `Track ${i}`, thumbnail: "", preset: "audio" as const, path: `/music/${i}.mp3`, timestamp: i + 1 }));
    await saveHistory(history);
    expect(await loadHistory()).toHaveLength(650);
  });
  it("surfaces failed disk saves and retries the latest pending value", async () => {
    state.failSave = true;
    await expect(persist("test", { value: 1 })).rejects.toThrow();
    await expect(persist("test", { value: 2 })).rejects.toThrow();
    const issue = storageIssues().find((i) => i.key === "write:test");
    expect(issue).toBeDefined();
    state.failSave = false;
    await issue!.retry();
    expect(state.data.test).toEqual({ value: 2 });
    expect(storageIssues().some((i) => i.key === "write:test")).toBe(false);
  });
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

describe("settings credentials", () => {
  const deletes = () => invoke.mock.calls.filter((c) => c[0] === "secret_delete" && c[1]?.name === "download-custom-args");
  it("keeps the saved header secret when the credential store could not be read", async () => {
    invoke.mockImplementation(async (cmd: string) => { if (cmd === "secret_get") throw new Error("keyring locked"); });
    state.data.settings = { ...DEFAULT_SETTINGS, customArgs: "[REDACTED]" };
    const loaded = await loadSettings();
    expect(loaded.customArgs).toBe("");
    await saveSettings({ ...loaded, theme: loaded.theme });
    expect(deletes()).toHaveLength(0);
    invoke.mockReset().mockResolvedValue(undefined);
  });
  it("still deletes the secret once it was readable and the user cleared it", async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === "secret_get" ? "--add-header Authorization:x" : undefined));
    state.data.settings = { ...DEFAULT_SETTINGS, customArgs: "[REDACTED]" };
    const loaded = await loadSettings();
    await saveSettings({ ...loaded, customArgs: "" });
    expect(deletes()).toHaveLength(1);
    invoke.mockReset().mockResolvedValue(undefined);
  });
});
