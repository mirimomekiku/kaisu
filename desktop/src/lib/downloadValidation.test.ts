import { describe, expect, it } from "vitest";
import cases from "../../testdata/download-validation.json";
import { checkDownloadUrl, checkSpeedLimit } from "./validate";
import { safeConcurrency, sanitizeDownloadExtra, sanitizeDownloadQueue } from "./downloadValidation";
const entry = (extra: object = {}) => ({ id: "saved-1", title: "Song", url: "https://example.com/song", outDir: "/music", preset: "audio", extra, progress: 25, status: "downloading" });
describe("shared download validation", () => {
  for (const [url, valid] of cases.urls) it(`URL: ${JSON.stringify(url)}`, () => expect(checkDownloadUrl(String(url)) === null).toBe(valid));
  for (const [rate, valid] of cases.rates) it(`speed: ${rate}`, () => expect(checkSpeedLimit(String(rate)) === null).toBe(valid));
  it("bounds persisted concurrency", () => {
    expect([NaN, Infinity, "4", null].map(safeConcurrency)).toEqual([2, 2, 2, 2]);
    expect([-5, 0, 1.7, 999].map(safeConcurrency)).toEqual([1, 1, 2, 6]);
  });
  it("restores older entries with defaults, keeps output choices, and strips proxy credentials", () => {
    const [saved] = sanitizeDownloadQueue([entry({ audio_format: "flac", proxy: "http://user:secret@proxy", output: { layout: "music" }, clip: { start: 5, end: 12, precise: true } })]);
    expect(saved).toMatchObject({ status: "paused", recoveryId: "saved-1", clipKey: "5-12", extra: { audio_format: "flac", proxy: null, output: { layout: "music", name: "title_id" } } });
  });
  it("skips corrupt records individually and removes duplicate IDs", () => {
    expect(sanitizeDownloadQueue([null, { ...entry(), url: "https://" }, entry(), entry(), { ...entry(), id: "other", extra: { rate_limit: "0" } }])).toHaveLength(1);
    expect(sanitizeDownloadQueue({ queue: [] })).toEqual([]);
  });
  it("rejects malformed nested choices without altering their meaning", () => {
    for (const extra of [{ audio_format: "exe" }, { clip: { start: 5, end: 2 } }, { playlist: { title: "Mix", index: 0, total: 1 } }, { output: { custom: "../x" } }, { format_id: "--exec" + " ".repeat(70) }]) expect(() => sanitizeDownloadExtra(extra)).toThrow();
  });
});
