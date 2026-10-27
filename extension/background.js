import { kaisuLinks, sendable } from "./kaisu-link.js";

const api = globalThis.browser ?? globalThis.chrome;
const MENU = "send-to-kaisu";
const TABS = "send-tabs-to-kaisu";

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: MENU, title: "Send to Kaisu", contexts: ["page", "link", "video", "audio"] });
    api.contextMenus.create({ id: TABS, title: "Send all tabs in this window to Kaisu", contexts: ["action"] });
  });
});

/** Opens the kaisu:// link from the page itself, so no blank tab is left behind. Restricted pages fall back to a short-lived tab. */
async function open(tab, link) {
  try {
    if (!tab?.id) throw new Error("no tab");
    await api.scripting.executeScript({ target: { tabId: tab.id }, func: (target) => { location.href = target; }, args: [link] });
  } catch {
    const helper = await api.tabs.create({ url: link, active: false });
    setTimeout(() => api.tabs.remove(helper.id).catch(() => {}), 4000);
  }
}

async function send(tab, urls) {
  const links = kaisuLinks(urls);
  if (links.length === 0) return badge(tab, "!", "#b3261e");
  for (const link of links) await open(tab, link);
  badge(tab, "OK", "#2e7d32");
}

function badge(tab, text, color) {
  const tabId = tab?.id;
  api.action.setBadgeBackgroundColor({ color, tabId });
  api.action.setBadgeText({ text, tabId });
  setTimeout(() => api.action.setBadgeText({ text: "", tabId }), 1800);
}

api.action.onClicked.addListener((tab) => send(tab, [tab.url]));

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === TABS) {
    const tabs = await api.tabs.query({ currentWindow: true });
    return send(tab ?? tabs[0], tabs.map((t) => t.url));
  }
  const target = sendable([info.linkUrl, info.srcUrl, info.pageUrl].filter(Boolean))[0];
  return send(tab, target ? [target] : []);
});
