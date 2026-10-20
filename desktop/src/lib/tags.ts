import type { MediaInfo, MetaOptions } from "./api";

export interface TagGuess {
  title: string;
  artist: string;
  album: string;
  year: string;
  track: string;
  genre: string;
}

const NOISE = /official|lyric|video|audio|\bhd\b|4k|remaster|visuali[sz]er/i;

/** Removes bracketed decorations at the end of a title: "Song (Official Video) [HD]" becomes "Song". */
export function stripNoise(title: string): string {
  let t = title.trim();
  for (;;) {
    const m = /\s*[([]([^)\]]*)[)\]]\s*$/.exec(t);
    if (!m || !NOISE.test(m[1])) return t;
    t = t.slice(0, m.index).trim();
  }
}

/** A sensible starting point for the tag editor, from what the site says about the video. */
export function guessTags(info: Pick<MediaInfo, "title" | "uploader" | "artist" | "track" | "album" | "release_year" | "genre">): TagGuess {
  let artist = (info.artist ?? "").trim();
  let title = (info.track ?? "").trim();
  if (!title) {
    title = stripNoise(info.title);
    const split = title.split(" - ");
    if (split.length >= 2) {
      const left = split[0].trim();
      const right = split.slice(1).join(" - ").trim();
      if (!artist || left.toLowerCase() === artist.toLowerCase()) {
        artist = left;
        title = right;
      }
    }
  }
  if (!artist) artist = (info.uploader ?? "").replace(/\s+-\s+Topic$/i, "").trim();
  return {
    title,
    artist,
    album: (info.album ?? "").trim(),
    year: info.release_year ? String(info.release_year) : "",
    track: "",
    genre: (info.genre ?? "").trim(),
  };
}

/** Only what the user changed, so untouched fields keep whatever the file already had. Null when nothing changed. */
export function changedTags(now: TagGuess, start: TagGuess): MetaOptions | null {
  const out: MetaOptions = {};
  let any = false;
  for (const key of Object.keys(now) as Array<keyof TagGuess>) {
    const value = now[key].trim();
    if (value !== start[key].trim() && (value !== "" || start[key].trim() !== "")) {
      out[key] = value;
      any = true;
    }
  }
  // A cleared field means "leave it alone", not "write an empty tag".
  for (const key of Object.keys(out) as Array<keyof MetaOptions>) if (out[key] === "") delete out[key];
  return any && Object.keys(out).length > 0 ? out : null;
}

/** Things worth knowing before downloading, from what the site says about the video. */
export function headsUp(info: Pick<MediaInfo, "availability" | "age_limit" | "live_status" | "is_live">, hasCookies: boolean): string[] {
  const notes: string[] = [];
  const how = hasCookies ? "Your browser's login will be used." : "Advanced mode can use your browser's login.";
  switch (info.availability) {
    case "needs_auth":
      notes.push(`This video needs you to be signed in. ${how}`);
      break;
    case "subscriber_only":
      notes.push(`This video is for channel members only. ${how}`);
      break;
    case "premium_only":
      notes.push(`This video is for paying subscribers only. ${how}`);
      break;
    case "private":
      notes.push("This video is private, so it probably can't be downloaded.");
      break;
  }
  if ((info.age_limit ?? 0) >= 18 && info.availability !== "needs_auth") notes.push(`This video is age-restricted. ${how}`);
  if (info.live_status === "is_upcoming") notes.push("This live stream hasn't started yet. Try again once it is on air.");
  else if (info.is_live || info.live_status === "is_live") notes.push("This is a live stream. Downloading it may not work until it has ended.");
  return notes;
}
