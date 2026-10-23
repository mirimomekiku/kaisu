import type { ExtraOptions, Preset } from "./api";
import { canonicalUrl } from "./links";
import { redactText, sensitiveCustomArgs } from "./redact";

type Identity = { url: string; preset: Preset; clipKey?: string; extra?: ExtraOptions; profile?: string; outDir?: string };
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
/** Network settings do not change the artifact; output, processing and tagging choices do. */
export function outputProfile(extra?: ExtraOptions, preset?: Preset): string {
  if (!extra) return "";
  const { proxy: _p, rate_limit: _r, verbose: _v, cookies_from_browser: _c, collision: _x, fragment_limit: _f, managed_retries: _m, credentials_required: _s, ...rest } = extra;
  const tags = Object.fromEntries(Object.entries(extra.meta ?? {}).filter(([, value]) => value != null && value !== ""));
  const artifact: Record<string, unknown> = { ...rest,
    audio: { quality: extra.audio?.quality || "0", normalize: extra.audio?.normalize === true, trim_silence: extra.audio?.trim_silence === true },
    cover: extra.cover?.mode === "custom" ? extra.cover : { mode: extra.cover?.mode ?? "default" },
    lyrics: extra.lyrics ?? "off", meta: Object.keys(tags).length ? tags : null,
    subs: extra.subs?.embed || extra.subs?.file ? extra.subs : null,
    custom_args: extra.custom_args?.trim() || null,
  };
  if (preset && preset !== "audio") { delete artifact.audio; delete artifact.audio_format; delete artifact.cover; delete artifact.lyrics; }
  if (typeof artifact.custom_args === "string" && sensitiveCustomArgs(artifact.custom_args)) artifact.custom_args = "[credential options]";
  return redactText(JSON.stringify(stable(artifact)));
}
const destination = (path: string) => /^[a-z]:[\\/]|^\\\\/i.test(path) ? path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : path.replace(/\/+$/, "");
export const sameDownload = (a: Identity, b: Identity) => canonicalUrl(a.url) === canonicalUrl(b.url)
  && a.preset === b.preset && (a.clipKey ?? "") === (b.clipKey ?? "")
  && (!a.outDir || !b.outDir || destination(a.outDir) === destination(b.outDir))
  && (a.profile ?? outputProfile(a.extra, a.preset)) === (b.profile ?? outputProfile(b.extra, b.preset));

export function uniqueDownloads<T extends Identity>(inputs: T[], existing: Identity[]): T[] {
  const accepted: T[] = [];
  for (const input of inputs) if (![...existing, ...accepted].some((item) => sameDownload(item, input))) accepted.push(input);
  return accepted;
}
