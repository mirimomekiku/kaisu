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
export function persistedDownload<T extends { url: string; title?: string; thumbnail?: string; extra: { proxy: string | null; custom_args: string | null; credentials_required?: boolean } }>(item: T): T {
  const url = redactText(item.url), custom = item.extra.custom_args;
  const sensitive = !!custom && sensitiveCustomArgs(custom);
  return { ...item, url, title: item.title === undefined ? undefined : redactText(item.title), thumbnail: item.thumbnail === undefined ? undefined : redactText(item.thumbnail), extra: { ...item.extra, proxy: null,
    custom_args: sensitive ? REDACTED : custom,
    ...(sensitive || url !== item.url ? { credentials_required: true } : {}),
  } };
}
