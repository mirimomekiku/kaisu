import { describe, expect, it } from "vitest";
import { sameDownload, uniqueDownloads, outputProfile } from "./downloadIdentity";
import { buildExtra } from "./extra";
import { DEFAULT_SETTINGS } from "./storage";
import { canonicalUrl, hostOf } from "./links";
import { networkAllocation } from "./networkBudget";
import { isRateLimited, retryAfterSeconds, retryDelaySeconds } from "./errors";
import { persistedDownload, redactText } from "./redact";

const job = () => ({ url: "https://youtu.be/abcdefghijk", preset: "audio" as const, outDir: "/music", extra: buildExtra(DEFAULT_SETTINGS, null) });
describe("artifact identity and enqueue reservations", () => {
  it("distinguishes audio formats, explicit streams, processing, metadata and destinations", () => {
    const a = job();
    expect(sameDownload(a, { ...a, extra: { ...a.extra, audio_format: "flac" } })).toBe(false);
    expect(sameDownload(a, { ...a, extra: { ...a.extra, format_id: "251" } })).toBe(false);
    expect(sameDownload(a, { ...a, extra: { ...a.extra, audio: { quality: "192K", normalize: true, trim_silence: false } } })).toBe(false);
    expect(sameDownload(a, { ...a, extra: { ...a.extra, meta: { artist: "Other" } } })).toBe(false);
    expect(sameDownload(a, { ...a, outDir: "/archive" })).toBe(false);
  });
  it("ignores network settings and normalizes Windows folder aliases", () => {
    const a = { ...job(), outDir: "D:\\Music\\" };
    expect(sameDownload(a, { ...a, outDir: "d:/music", extra: { ...a.extra, proxy: "http://proxy:8080", rate_limit: "1M", fragment_limit: 1, managed_retries: true } })).toBe(true);
    expect(sameDownload(job(), { ...job(), outDir: "/Music" })).toBe(false);
  });
  it("normalizes omitted processing defaults from restored queues", () => {
    const a = job();
    expect(sameDownload(a, { ...a, extra: { ...a.extra, audio: { quality: null, normalize: false, trim_silence: false }, cover: { mode: "default" }, lyrics: "off", meta: {} } })).toBe(true);
  });
  it("local playlist destinations do not create a second media artifact", () => {
    const a = job();
    expect(sameDownload(a, { ...a, extra: { ...a.extra, library_playlist_ids: ["pl-one", "pl-two"] } })).toBe(true);
  });
  it("deduplicates within a batch and against synchronously reserved jobs", () => {
    const a = job(), flac = { ...a, extra: { ...a.extra, audio_format: "flac" as const } };
    const first = uniqueDownloads([a, a, flac], []);
    expect(first).toHaveLength(2);
    expect(uniqueDownloads([a, flac], first)).toEqual([]);
  });
  it("preserves generic ports, mobile hosts, path and query semantics", () => {
    for (const other of ["https://example.com:444/a?index=1", "https://m.example.com/a?index=1", "https://example.com/a?index=2", "https://example.com/a/?index=1"]) {
      expect(canonicalUrl(other)).not.toBe(canonicalUrl("https://example.com/a?index=1"));
    }
    expect(hostOf("https://youtu.be/abcdefghijk")).toBe(hostOf("https://music.youtube.com/watch?v=abcdefghijk"));
  });
  it("does not put custom header values in the history profile", () => {
    const extra = { ...job().extra, custom_args: '--add-headers "Authorization: Bearer private-value"' };
    expect(outputProfile(extra)).not.toContain("private-value");
  });
});

describe("shared network reservations", () => {
  it("bounds connections and speed across every configured queue slot", () => {
    for (const concurrency of [1, 2, 4, 6]) for (const budget of [1, 2, 5, 8, 24]) {
      const allocation = networkAllocation(concurrency, budget, "2M");
      expect(allocation.slots * allocation.fragments).toBeLessThanOrEqual(budget);
      expect(allocation.slots * Number(allocation.rate(null))).toBeLessThanOrEqual(2 * 1048576);
      expect(Number(allocation.rate("1"))).toBe(1);
    }
  });
  it("handles one byte per second and corrupt settings without allocating zero-byte slots", () => {
    const tiny = networkAllocation(6, 24, "1");
    expect(tiny.slots).toBe(1); expect(tiny.rate(null)).toBe("1");
    expect(networkAllocation(NaN, Infinity, "NaN").slots).toBe(2);
  });
  it("preserves per-job caps when the shared cap is disabled", () => {
    expect(networkAllocation(2).rate("500K")).toBe("500K");
    expect(networkAllocation(2).rate(null)).toBeNull();
  });
});

describe("retry coordination", () => {
  it("jitters increasing backoff within bounds", () => {
    expect(retryDelaySeconds(3, 0)).toBe(36);
    expect(retryDelaySeconds(3, 1)).toBe(54);
    expect(retryDelaySeconds(5, 1)).toBe(72);
  });
  it("recognizes rate limiting and bounds Retry-After hints", () => {
    expect(isRateLimited("HTTP Error 429: Too Many Requests")).toBe(true);
    expect(retryAfterSeconds("Retry-After: 120")).toBe(120);
    expect(retryAfterSeconds("Retry-After: 999999999999999")).toBe(3600);
    expect(retryAfterSeconds("unavailable")).toBe(0);
  });
});

describe("safe persisted downloads", () => {
  it("redacts signed query values and header values while preserving media identifiers", () => {
    const source = "https://cdn.example/video?v=abc&%74oken=private&X-Amz-Signature=signature-secret";
    const safe = redactText(source);
    expect(safe).not.toContain("private"); expect(safe).not.toContain("signature-secret"); expect(safe).toContain("v=abc");
    expect(redactText("Authorization: Bearer private")).toBe("Authorization: [REDACTED]");
    expect(redactText("Cookie: session=private")).toBe("Cookie: [REDACTED]");
  });
  it("never mutates the live request and marks credential recovery as needing fresh input", () => {
    const source = { ...job(), title: "Video", url: "https://cdn.example/video?token=private", extra: { ...job().extra, custom_args: '--add-headers "Cookie: session=private"' } };
    const safe = persistedDownload(source);
    expect(JSON.stringify(safe)).not.toContain("private");
    expect(safe.extra.credentials_required).toBe(true);
    expect(source.url).toContain("private"); expect(source.extra.custom_args).toContain("private");
  });
});
