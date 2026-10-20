/** Pulls every http(s) link out of a piece of text (a drop, a paste, the clipboard). */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  // Trailing punctuation from prose ("see https://x.com/a.") isn't part of the link.
  const cleaned = found.map((u) => u.replace(/[),.;:!?\]]+$/, ""));
  return [...new Set(cleaned)];
}

const MEDIA_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "twitch.tv",
  "soundcloud.com",
  "bandcamp.com",
  "dailymotion.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "twitter.com",
  "x.com",
  "reddit.com",
  "v.redd.it",
  "bilibili.com",
  "nicovideo.jp",
  "streamable.com",
  "rumble.com",
];

/**
 * Links worth offering to download when they show up on the clipboard. Deliberately a short list of well-known
 * media sites: the clipboard is full of ordinary links, and nobody wants a prompt for each one.
 */
export function isMediaHost(link: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return MEDIA_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** "https://www.youtube.com/watch?v=abc" -> "youtube.com/watch?v=abc", shortened for display. */
export function shortLink(link: string, max = 60): string {
  const bare = link.replace(/^https?:\/\/(www\.)?/i, "");
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}

/** The playlist a video link belongs to, if it names one worth offering (mixes are endless, so skipped). */
export function playlistOf(link: string): { id: string; url: string } | null {
  try {
    const u = new URL(link);
    const list = u.searchParams.get("list");
    if (!list || /^(RD|UL|TL|LL)/.test(list)) return null;
    if (!/youtube\.com$|youtu\.be$/.test(u.hostname.replace(/^www\.|^m\./, ""))) return null;
    return { id: list, url: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}` };
  } catch {
    return null;
  }
}

const NOISE_PARAMS = new Set(["list", "index", "t", "start", "si", "feature", "pp", "ab_channel", "utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid", "app"]);

/**
 * The same video can be linked many ways (youtu.be/x, m.youtube.com/watch?v=x&t=30s, a playlist link...). This
 * reduces a link to one form so duplicates are recognised. Links that aren't understood are returned as they are.
 */
export function canonicalUrl(link: string): string {
  try {
    const u = new URL(link.trim());
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/")[1];
      return id ? `https://youtube.com/watch?v=${id}` : link;
    }
    if (host === "youtube.com") {
      const shorts = /^\/(shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname);
      if (shorts) return `https://youtube.com/watch?v=${shorts[2]}`;
      const v = u.searchParams.get("v");
      if (u.pathname === "/watch" && v) return `https://youtube.com/watch?v=${v}`;
    }
    const keep = [...u.searchParams.entries()].filter(([k]) => !NOISE_PARAMS.has(k.toLowerCase())).sort(([a], [b]) => a.localeCompare(b));
    const query = keep.length ? `?${new URLSearchParams(keep).toString()}` : "";
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
    return `${u.protocol}//${host}${path}${query}`;
  } catch {
    return link;
  }
}

/** The website part of a link ("youtube.com"), used to limit how many downloads hit one site at once. */
export function hostOf(link: string): string {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  } catch {
    return "";
  }
}
