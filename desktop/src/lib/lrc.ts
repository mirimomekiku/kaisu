// Synced lyrics in the common `.lrc` format: lines of text each with the time they are sung.
//
//   [ti:Song name]            information lines are ignored
//   [offset:+250]             shifts every time (milliseconds; positive means the words come earlier)
//   [00:12.50] First line
//   [01:05.1][02:30.75] A line that repeats

export interface LrcLine {
  /** Seconds from the start. */
  time: number;
  text: string;
}

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/y;
const OFFSET = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/im;

/** `[mm:ss.xx]` at the start of `text` (hundredths, tenths or milliseconds), and how many characters it took. */
function stampAt(text: string, from: number): { seconds: number; length: number } | null {
  STAMP.lastIndex = from;
  const m = STAMP.exec(text);
  if (!m) return null;
  const fraction = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
  return { seconds: Number(m[1]) * 60 + Number(m[2]) + fraction, length: m[0].length };
}

/** The lines of an `.lrc` file in time order. Lines without a time (titles, notes) are left out. */
export function parseLrc(text: string): LrcLine[] {
  const offset = Number(OFFSET.exec(text)?.[1] ?? 0) / 1000;
  const lines: LrcLine[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const times: number[] = [];
    let at = 0;
    for (let stamp = stampAt(raw, at); stamp; stamp = stampAt(raw, at)) {
      times.push(stamp.seconds);
      at += stamp.length;
    }
    if (times.length === 0) continue;
    const words = raw.slice(at).trim();
    for (const t of times) lines.push({ time: Math.max(0, t - offset), text: words });
  }
  // A stable sort keeps lines with equal times in the order they were written.
  return lines.sort((a, b) => a.time - b.time);
}

/** Which line is being sung at `seconds`: the last one that has started, or -1 before the first. */
export function lineAt(lines: LrcLine[], seconds: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
