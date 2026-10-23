const SECRET_KEY = /token|auth|signature|^sig$|api.?key|credential|password|policy|session|^key$|^hmac$/i;
export const REDACTED = "[REDACTED]";
export function redactText(text: string): string {
  return text.replace(/(\w+:\/\/[^\s/?:@]+:)[^\s/@]*@/g, "$1[REDACTED]@")
    .replace(/([?&])([^\s?&=#]+)=([^\s&#"'<>]*)/g, (all, sep: string, key: string) => {
      let decoded = key;
      try { decoded = decodeURIComponent(key); } catch { /* Keep malformed keys literal. */ }
      return SECRET_KEY.test(decoded) ? `${sep}${key}=${REDACTED}` : all;
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
