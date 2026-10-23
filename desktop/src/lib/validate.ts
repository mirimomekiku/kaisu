/** Checks for typed settings, so a mistake is pointed out as it is made rather than when something fails. */

const PROXY_SCHEMES = ["http", "https", "socks4", "socks4a", "socks5", "socks5h"];

/** Why a proxy address can't work, or null when it looks fine (an empty one means "no proxy"). */
export function checkProxy(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/\s/.test(t)) return "A proxy address can't contain spaces.";
  if (t.length > 300) return "That proxy address is too long.";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return "That doesn't look like a proxy address. Try socks5://127.0.0.1:1080 or host:port.";
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (!PROXY_SCHEMES.includes(scheme)) return `Proxies of type "${scheme}" aren't supported. Use http, https, socks4 or socks5.`;
  if (!url.hostname) return "The proxy address needs a host.";
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) return "A proxy address is just host and port, with no path.";
  if (url.port && Number(url.port) === 0) return "The port can't be 0.";
  return null;
}

/** Why a speed limit isn't valid (like 500K or 2M), or null. Empty means no limit. */
export function checkSpeedLimit(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(\.\d+)?[KkMm]?$/.test(t)) return "Use a number with K or M, like 500K or 2M.";
  const bytes = Number.parseFloat(t) * (/[Kk]$/.test(t) ? 1024 : /[Mm]$/.test(t) ? 1048576 : 1);
  if (t.length > 32 || !Number.isFinite(bytes) || bytes < 1 || bytes > 1e12) return "Use a limit between 1 byte/s and 1 TB/s.";
  return null;
}

export function checkDownloadUrl(text: string): string | null {
  const value = text.trim();
  try {
    const u = new URL(value);
    if (!/^https?:\/\//i.test(value) || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value) || !["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password) throw new Error();
    return null;
  } catch { return "Enter a full web link (starting with http:// or https://) without spaces or embedded credentials."; }
}

/** Why an audio quality isn't valid: 0 to 9, or a bitrate like 192K. Empty means best. */
export function checkAudioQuality(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d$/.test(t)) return null;
  const m = /^(\d{2,3})[Kk]$/.exec(t);
  if (m && Number(m[1]) >= 32 && Number(m[1]) <= 512) return null;
  return "Use 0 to 9, or a bitrate from 32K to 512K, like 192K.";
}

/** Checks a tag typed into the tag editor. */
export function checkTag(field: "year" | "track" | "text", value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (field === "year") return /^[12]\d{3}$/.test(v) ? null : "The year must be four digits, like 2024.";
  if (field === "track") return /^[1-9]\d{0,2}$/.test(v) ? null : "The track number must be a whole number from 1 to 999.";
  return v.length <= 200 ? null : "That is too long (up to 200 characters).";
}
