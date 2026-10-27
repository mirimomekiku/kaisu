// Builds kaisu://add links. Pure, so it can be tested without a browser.
export const MAX_URLS_PER_LINK = 20;
// Windows passes the whole link to Kaisu on its command line, so keep each one comfortably short.
export const MAX_LINK_LENGTH = 6000;

/** The http(s) addresses worth sending: no credentials, no browser pages, no duplicates. */
export function sendable(urls) {
  const seen = new Set();
  for (const raw of urls) {
    let url;
    try { url = new URL(raw); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    seen.add(url.href);
  }
  return [...seen];
}

/** One or more kaisu://add links covering every address. */
export function kaisuLinks(urls) {
  const links = [];
  let batch = [];
  const build = (items) => `kaisu://add?${items.map((u) => `url=${encodeURIComponent(u)}`).join("&")}`;
  for (const url of sendable(urls)) {
    if (build([url]).length > MAX_LINK_LENGTH) continue;
    if (batch.length === MAX_URLS_PER_LINK || (batch.length && build([...batch, url]).length > MAX_LINK_LENGTH)) { links.push(build(batch)); batch = []; }
    batch.push(url);
  }
  if (batch.length) links.push(build(batch));
  return links;
}
