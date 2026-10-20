import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  const cases: Array<[string, RegExp]> = [
    ["ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate", /signed in/],
    ["ERROR: Private video. Sign in if you've been granted access", /signed in/],
    ["ERROR: [youtube] x: Video unavailable", /isn't available/],
    ["ERROR: Unsupported URL: https://example.com/", /isn't a video/],
    ["HTTP Error 429: Too Many Requests", /limiting requests/],
    ["HTTP Error 403: Forbidden", /refused/],
    ["Unable to download webpage: <urlopen error [Errno -2] Name or service not known>", /connect/],
    ["The download server answered 500", /Something went wrong/],
    ["[Errno 28] No space left on device", /disk is full/],
    ["PermissionError: [Errno 13] Permission denied", /can't save/],
    ["ERROR: Postprocessing: ffprobe and ffmpeg not found", /helper tool/],
    ["The video downloader (yt-dlp) isn't installed yet. Open Setup to install it.", /finish setting up/],
    ["Type something to search for.", /search/],
  ];
  for (const [raw, expected] of cases) {
    it(`explains: ${raw.slice(0, 50)}`, () => expect(friendlyError(raw).summary).toMatch(expected));
  }
  it("always gives a summary, even for the unknown", () => {
    expect(friendlyError("???").summary.length).toBeGreaterThan(0);
  });
});
