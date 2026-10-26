/** Query and header names whose values are secret. Checked against `testdata/download-validation.json`, which Rust also reads. */
export const SECRET_KEY_PARTS = ["token", "signature", "password", "credential", "secret", "apikey", "api_key", "api-key"] as const;
export const SECRET_KEY_EXACT = ["auth", "authorization", "authkey", "auth_key", "auth-key", "sig", "key", "hmac", "policy", "session", "sessionid", "session_id"] as const;
export const isSecretKey = (key: string) => {
  const name = key.toLowerCase();
  return (SECRET_KEY_EXACT as readonly string[]).includes(name) || SECRET_KEY_PARTS.some((part) => name.includes(part));
};
export const REDACTED = "[REDACTED]";
export function redactText(text: string): string {
  return text.replace(/(\w+:\/\/[^\s/?:@]+:)[^\s/@]*@/g, "$1[REDACTED]@")
    .replace(/([?&])([^\s?&=#]+)=([^\s&#"'<>]*)/g, (all, sep: string, key: string) => {
      let decoded = key;
      try { decoded = decodeURIComponent(key); } catch { /* Keep malformed keys literal. */ }
      return isSecretKey(decoded) ? `${sep}${key}=${REDACTED}` : all;
    })
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*[:=][^\r\n]*/gi, "$1: [REDACTED]");
}
export const sensitiveCustomArgs = (text: string) => /--(?:add-headers|extractor-args|referer)(?:\s|=)|authorization|cookie\s*:|token\s*[:=]|password\s*[:=]/i.test(text);

/** The same quoting rules as native custom_args::split_args; no shell evaluation. */
export function customSecretValues(text: string | null | undefined): string[] {
  const args: string[] = [];
  let current = "", quote = "", started = false;
  for (let i = 0; i < (text?.length ?? 0); i++) {
    const c = text![i];
    if (quote && c === quote) quote = "";
    else if (quote === '"' && c === "\\" && ['"', "\\"].includes(text![i + 1])) current += text![++i];
    else if (quote) current += c;
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started || current) args.push(current); current = ""; started = false; }
    else current += c;
  }
  if (quote) return []; // Native validation rejects unmatched quotes without echoing their payload.
  if (started || current) args.push(current);
  const values: string[] = [];
  args.forEach((arg, i) => {
    const at = arg.indexOf("="), option = at < 0 ? arg : arg.slice(0, at);
    if (!["--add-headers", "--extractor-args", "--referer"].includes(option)) return;
    const value = at < 0 ? args[i + 1] : arg.slice(at + 1);
    if (value === undefined) return;
    values.push(value);
    if (option === "--add-headers" && value.includes(":")) values.push(value.slice(value.indexOf(":") + 1).trim());
    if (option === "--extractor-args") for (const field of value.split(";")) {
      const equals = field.indexOf("=");
      if (equals < 0) continue;
      for (const token of field.slice(equals + 1).split(",")) {
        values.push(token);
        if (token.includes("+")) values.push(token.slice(token.indexOf("+") + 1));
      }
    }
  });
  for (const value of [...values]) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    values.push(escaped.replace(/'/g, "\\'"), escaped.replace(/"/g, '\\"'));
  }
  return [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
}

export function redactCustomText(text: string, values: readonly string[]): string {
  let safe = text;
  for (const value of values) {
    if (value.length >= 4) safe = safe.split(value).join(REDACTED);
    else {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      safe = safe.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu"), REDACTED);
    }
  }
  return redactText(safe);
}
export function persistedDownload<T extends { url: string; title?: string; thumbnail?: string; extra: { proxy: string | null; custom_args: string | null; credentials_required?: boolean } }>(item: T): T {
  const url = redactText(item.url), custom = item.extra.custom_args;
  const sensitive = !!custom && sensitiveCustomArgs(custom);
  return { ...item, url, title: item.title === undefined ? undefined : redactText(item.title), thumbnail: item.thumbnail === undefined ? undefined : redactText(item.thumbnail), extra: { ...item.extra, proxy: null,
    custom_args: sensitive ? REDACTED : custom,
    ...(sensitive || url !== item.url ? { credentials_required: true } : {}),
  } };
}
