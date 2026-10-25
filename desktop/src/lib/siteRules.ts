import type { AudioFormat, Preset } from "./api";
import { AUDIO_FORMAT_IDS, audioFormatName } from "./audioFormats";
import { PRESET_LABEL } from "./format";

/**
 * Site rules (Advanced mode): downloads from a site, or from a channel on it, can always be a certain kind of file, in a
 * certain audio format, and go to a certain folder. "Podcasts always go to this drive, as MP3."
 *
 * The first rule that matches wins. A rule matches when the link's host is the rule's site or a part of it (a rule for
 * `youtube.com` also covers `music.youtube.com`; one for `music.youtube.com` covers only that), and, if the rule names a
 * channel, when the channel's name contains those words.
 */
export interface SiteRule {
  id: string;
  /** `youtube.com`, or a longer name like `music.youtube.com`. */
  host: string;
  /** Only downloads from a channel whose name contains this (any capitals). Empty means any channel. */
  channel: string;
  /** What to download instead of what was asked for. Empty means leave it alone. */
  preset: Preset | "";
  /** The format for audio downloads. Empty means the one in Settings. */
  audioFormat: AudioFormat | "";
  /** Where to save. Empty means the usual download folder. */
  folder: string;
}

export const AUDIO_FORMATS: AudioFormat[] = AUDIO_FORMAT_IDS;
const PRESETS: Preset[] = ["best", "p1080", "p720", "audio"];
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

let counter = 0;
export const blankSiteRule = (): SiteRule => ({ id: `site-${Date.now().toString(36)}-${counter++}`, host: "", channel: "", preset: "", audioFormat: "", folder: "" });

/** `https://www.Example.com:8080/path` → `example.com`. Leading `www.` is dropped; anything else stays. */
export function normalizeHost(text: string): string {
  let t = text.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(t)) {
    try {
      t = new URL(t).hostname;
    } catch {
      return "";
    }
  }
  return t.replace(/[/:?#].*$/, "").replace(/\.$/, "").replace(/^www\./, "");
}

/** Whether a folder typed or picked looks like a full path on Windows or Linux. */
export const looksAbsolute = (folder: string) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(folder.trim());

/** What is wrong with a rule, or null when it can be used. */
export function validateSiteRule(rule: SiteRule): string | null {
  const host = normalizeHost(rule.host);
  if (!host) return "Enter the site, like youtube.com.";
  if (!HOST_PATTERN.test(host)) return `"${rule.host.trim()}" doesn't look like a site name. Use something like youtube.com.`;
  if (rule.channel.trim().length > 100) return "The channel name is too long.";
  if (!rule.preset && !rule.audioFormat && !rule.folder.trim()) return "Choose what the rule should do: a kind of download, an audio format or a folder.";
  if (rule.folder.trim() && !looksAbsolute(rule.folder)) return "The folder must be a full path, like D:\\Music or /home/me/Music.";
  return null;
}

/** A sentence saying what the rule does. */
export function describeSiteRule(rule: SiteRule): string {
  const from = `${rule.channel.trim() ? `${rule.channel.trim()} on ` : ""}${normalizeHost(rule.host) || "…"}`;
  const does: string[] = [];
  if (rule.preset) does.push(`downloaded as ${rule.preset === "audio" ? "audio" : PRESET_LABEL[rule.preset]}`);
  if (rule.audioFormat) does.push(`audio as ${audioFormatName(rule.audioFormat)}`);
  if (rule.folder.trim()) does.push(`saved in ${rule.folder.trim()}`);
  return does.length ? `Anything from ${from} is ${does.join(", ")}.` : `Anything from ${from}.`;
}

/** The first usable rule for a link (and the channel it came from, when known). */
export function matchSiteRule(rules: SiteRule[], link: string, channel?: string | null): SiteRule | null {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const chan = (channel ?? "").toLowerCase();
  return (
    rules.find((r) => {
      if (validateSiteRule(r) !== null) return false;
      const site = normalizeHost(r.host);
      if (host !== site && !host.endsWith(`.${site}`)) return false;
      const want = r.channel.trim().toLowerCase();
      return want === "" || chan.includes(want);
    }) ?? null
  );
}

/** Settings may hold anything (an older version, a hand edit): keep only what is shaped like a rule. */
export function sanitizeSiteRules(raw: unknown): SiteRule[] {
  if (!Array.isArray(raw)) return [];
  const text = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .slice(0, 50)
    .map((r, i) => ({
      id: text(r.id, 60) || `site-restored-${i}`,
      host: text(r.host, 200),
      channel: text(r.channel, 100),
      preset: PRESETS.includes(r.preset as Preset) ? (r.preset as Preset) : "",
      audioFormat: AUDIO_FORMATS.includes(r.audioFormat as AudioFormat) ? (r.audioFormat as AudioFormat) : "",
      folder: text(r.folder, 500),
    }));
}
