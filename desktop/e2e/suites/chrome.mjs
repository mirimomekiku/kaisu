import { BASE_URL, browser } from "../harness.mjs";
const errors = [];
let failed = 0, passed = 0;
const check = (name, ok, extra = "") => { ok ? passed++ : failed++; if (!ok) console.log("FAIL", name, extra); };
const now = Date.now();
const HISTORY = [
  { id: "h4", url: "https://www.youtube.com/watch?v=vid00000002", title: "Searchable Song", thumbnail: "", preset: "audio", path: "/home/u/Downloads/song.mp3", timestamp: now - 4000 },
  { id: "h5", url: "https://www.youtube.com/watch?v=vid00000011", title: "Gone", thumbnail: "", preset: "best", path: "/home/u/Downloads/gone.mp4", timestamp: now - 5000 },
];
async function open({ ready = true, mock = {} } = {}) { const st = { warnDuplicates: false };
  const ctx = await browser.newContext({ viewport: { width: 1060, height: 780 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE_URL).origin });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(([r, mk, h]) => {
    window.__mock = { ready: r, calls: [], dlDelay: 100, missing: ["/home/u/Downloads/gone.mp4"], setupDelay: 100, ...mk };
    localStorage.setItem("__store", JSON.stringify({ settings: { mode: "simple", tourSeen: true, warnDuplicates: false }, history: h }));
  }, [ready, mock, HISTORY]);
  await page.goto(BASE_URL);
  return page;
}
const calls = (page, cmd) => page.evaluate((c) => window.__mock.calls.filter((x) => x.cmd === c), cmd);
const box = (page) => page.getByLabel("Search YouTube or paste a link");
const results = (page) => page.locator("section[aria-label='Search results']");
const menu = (page) => page.getByRole("menu");
const cursor = (loc) => loc.first().evaluate((e) => getComputedStyle(e).cursor);

// ================= font =================
let page = await open();
await page.waitForSelector("input[type=text]");
await page.evaluate(() => document.fonts.ready);
const font = await page.evaluate(async () => {
  await document.fonts.load('400 12px "Work Sans Variable"');
  return {
    family: getComputedStyle(document.body).fontFamily,
    loaded: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Work Sans Variable" && f.status === "loaded"),
    check: document.fonts.check('600 14px "Work Sans Variable"'),
  };
});
check("font: body uses Work Sans", /Work Sans/.test(font.family), font.family);
check("font: the Work Sans file is actually loaded (not a fallback)", font.loaded && font.check, JSON.stringify(font));
check("font: toolbar, buttons and inputs inherit it", (await page.evaluate(() => ["button", "input", "select"].every((t) => { const e = document.querySelector(t); return !e || /Work Sans/.test(getComputedStyle(e).fontFamily); }))));

// ================= window controls / title bar =================
const lights = page.getByRole("group", { name: "Window controls" });
check("titlebar: three window buttons in the toolbar", await lights.getByRole("button").count() === 3 && await page.locator("header.toolbar .lights").count() === 1);
check("titlebar: toolbar is a drag region", await page.locator("header.toolbar[data-tauri-drag-region]").count() === 1);
check("titlebar: status display + groups are drag regions too", await page.locator(".lcd[data-tauri-drag-region], .toolbar-group[data-tauri-drag-region]").count() >= 3);
check("titlebar: controls themselves are NOT drag regions", await page.locator(".lights [data-tauri-drag-region], .searchfield [data-tauri-drag-region]").count() === 0);
await lights.getByRole("button", { name: "Minimize window" }).click();
await lights.getByRole("button", { name: "Maximize window" }).click();
check("titlebar: minimize + zoom reach the window API", JSON.stringify(await page.evaluate(() => window.__mock.windowCalls)) === JSON.stringify(["minimize", "toggleMaximize"]));
check("titlebar: zoom button becomes Restore when maximized", await lights.getByRole("button", { name: "Restore window" }).count() === 1);
await lights.getByRole("button", { name: "Restore window" }).click();
check("titlebar: and back to Maximize", await lights.getByRole("button", { name: "Maximize window" }).count() === 1);
await lights.getByRole("button", { name: "Close window" }).click();
check("titlebar: close reaches the window API", (await page.evaluate(() => window.__mock.windowCalls)).at(-1) === "close");
await page.evaluate(() => window.__focus({ payload: false }));
check("titlebar: buttons grey out when the window loses focus", await page.waitForSelector(".lights.inactive", { timeout: 3000 }).then(() => true, () => false));
await page.evaluate(() => window.__focus({ payload: true }));
check("titlebar: and colour returns on focus", await page.waitForSelector(".lights:not(.inactive)", { timeout: 3000 }).then(() => true, () => false));
const lightColors = await page.evaluate(() => ["close", "min", "zoom"].map((c) => getComputedStyle(document.querySelector(`.light.${c}`)).backgroundImage));
check("titlebar: red / yellow / green are distinct", new Set(lightColors).size === 3);

// the setup screen has its own title bar, since the OS frame is off
const setup = await open({ ready: false });
await setup.waitForSelector("text=Let's get Kaisu ready");
check("titlebar: setup screen has a title bar with window buttons", await setup.locator(".titlebar[data-tauri-drag-region]").count() === 1 && await setup.getByRole("button", { name: "Close window" }).count() === 1);
await setup.getByRole("button", { name: "Minimize window" }).click();
check("titlebar: works on the setup screen", (await setup.evaluate(() => window.__mock.windowCalls)).includes("minimize"));

// ================= cursors =================
await page.bringToFront();
await box(page).fill("lofi beats");
await box(page).press("Enter");
await page.waitForSelector("text=lofi beats — result 1");
await results(page).getByRole("button", { name: /result 2/ }).click();
await page.locator("section[aria-label='Video details']").waitFor();
const cur = async (name, loc, want) => { const c = await cursor(loc); check(`cursor: ${name} → ${want}`, c === want, c); };
await cur("sidebar item", page.locator(".source").first(), "pointer");
await cur("push button", page.getByRole("button", { name: "Download video" }), "pointer");
await cur("window button", page.locator(".light.close"), "pointer");
await cur("view switcher", page.getByRole("radio", { name: "Grid view" }), "pointer");
await cur("result name link", results(page).getByRole("button", { name: /result 3/ }), "pointer");
await cur("row checkbox", results(page).getByLabel(/Select lofi beats — result 3/), "pointer");
await cur("select-all label", results(page).locator("label", { hasText: "Select all" }), "pointer");
await cur("choice tile (radio)", page.getByRole("radio", { name: /Audio only/ }), "pointer");
await cur("disclosure", page.getByRole("button", { name: "What would you like to download?" }), "pointer");
await cur("quality dropdown", page.getByRole("combobox").first(), "pointer");
await cur("'Show more' link", page.getByRole("button", { name: "Show more" }).first(), "pointer");
await cur("search text box", box(page), "text");
await cur("status display (not clickable)", page.locator(".lcd"), "default");
await cur("toolbar drag area", page.locator("header.toolbar"), "default");
await cur("table row body", results(page).locator("tbody tr").first(), "default");
await cur("column header", results(page).locator("thead th").first(), "default");
await page.getByRole("button", { name: /^Settings/ }).click();
await page.getByLabel("Settings section", { exact: true }).selectOption("Engine");
await page.getByRole("button", { name: "Check for updates" }).evaluate((b) => (b.disabled = true));
await cur("disabled button", page.getByRole("button", { name: "Check for updates" }), "not-allowed");
await page.getByRole("button", { name: /^Search/ }).click();

// ================= right-click context menu =================
const row = (n) => results(page).locator("tbody tr", { hasText: `result ${n}` }).first();
await row(2).click({ button: "right" });
check("menu: opens on right-click", await menu(page).count() === 1);
const items = (await menu(page).getByRole("menuitem").allTextContents()).map((t) => t.trim());
check("menu: single-item entries", ["Show details", "Download video", "Download video (720p)", "Download audio (MP3)", "Select", "Open in browser", "Copy link", "Copy title"].every((t) => items.includes(t)), items.join(" | "));
check("menu: search-by-channel entry", items.includes("Search “Channel 2”"));
check("menu: heading shows the title", await menu(page).locator(".heading", { hasText: "lofi beats — result 2" }).count() === 1);
const m = await menu(page).boundingBox();
check("menu: stays inside the window", m.x >= 0 && m.y >= 0 && m.x + m.width <= 1060 && m.y + m.height <= 780);
await page.keyboard.press("Escape");
check("menu: Escape closes it", await menu(page).count() === 0);
await row(2).click({ button: "right" });
await page.locator("footer").click({ position: { x: 5, y: 5 } });
check("menu: clicking elsewhere closes it", await menu(page).count() === 0);
check("menu: native browser menu is suppressed", await page.evaluate(() => { const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.querySelector(".itable tbody tr").dispatchEvent(ev); return ev.defaultPrevented; }));
check("menu: but kept for text fields", !(await page.evaluate(() => { const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.querySelector("input[type=text]").dispatchEvent(ev); return ev.defaultPrevented; })));
check("menu: and suppressed on plain chrome", await page.evaluate(() => { const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.querySelector(".sidebar").dispatchEvent(ev); return ev.defaultPrevented; }));

// actions
const lastDl = async () => (await calls(page, "start_download")).at(-1).args.req;
const act = async (n, name) => { await row(n).click({ button: "right" }); await menu(page).getByRole("menuitem", { name, exact: true }).click(); };
await act(2, "Download video");
await page.waitForFunction(() => window.__mock.calls.some((c) => c.cmd === "start_download"));
check("action: Download video", (await lastDl()).preset === "best" && (await lastDl()).url.endsWith("vid00000001"));
check("action: menu closes after choosing", await menu(page).count() === 0);
await act(5, "Download video (720p)");
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "start_download").length >= 2);
check("action: Download video (720p)", (await lastDl()).preset === "p720" && (await lastDl()).url.endsWith("vid00000004"));
await act(6, "Download audio (MP3)");
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "start_download").length >= 3);
check("action: Download audio", (await lastDl()).preset === "audio" && (await lastDl()).extra.audio_format === "mp3");
await act(7, "Show details");
await page.locator("section[aria-label='Video details']").waitFor();
check("action: Show details inspects that video", (await calls(page, "get_media_info")).at(-1).args.url.endsWith("vid00000006"));
await act(8, "Select");
check("action: Select ticks the row", await results(page).getByLabel(/Select lofi beats — result 8$/).isChecked());
await row(8).click({ button: "right" });
check("action: label flips to Deselect", await menu(page).getByRole("menuitem", { name: "Deselect", exact: true }).count() === 1);
await menu(page).getByRole("menuitem", { name: "Deselect", exact: true }).click();
check("action: Deselect unticks it", !(await results(page).getByLabel(/Select lofi beats — result 8$/).isChecked()));
await act(9, "Copy link");
const saidSo = await page.getByLabel("Status display").locator("text=Link copied").waitFor({ timeout: 5000 }).then(() => true, () => false);
check("action: ...and says so", saidSo);
check("action: Copy link puts the URL on the clipboard", (await page.evaluate(() => navigator.clipboard.readText())).endsWith("vid00000008"));

await act(9, "Copy title");
check("action: Copy title", (await page.evaluate(() => navigator.clipboard.readText())) === "lofi beats — result 9");
await act(9, "Open in browser");
check("action: Open in browser asks the OS", (await calls(page, "open_url")).at(-1).args.url.endsWith("vid00000008"));
await act(3, "Search “Channel 3”");
await page.waitForFunction(() => window.__mock.calls.at(-1)?.cmd === "search_media" || window.__mock.calls.some((c) => c.cmd === "search_media" && c.args.query === "Channel 3"));
check("action: Search by channel", (await calls(page, "search_media")).at(-1).args.query === "Channel 3" && (await box(page).inputValue()) === "Channel 3");
await page.waitForSelector("text=Channel 3 — result 1");

// downloaded + moved + live
await box(page).fill("lofi beats"); await box(page).press("Enter");
await page.waitForSelector("text=lofi beats — result 1");
await row(3).click({ button: "right" });
const dl3 = await menu(page).getByRole("menuitem").allTextContents();
check("downloaded: file actions offered", dl3.some((t) => t.includes("Open downloaded file")) && dl3.some((t) => t.includes("Show in folder")));
await menu(page).getByRole("menuitem", { name: "Open downloaded file", exact: true }).click();
check("downloaded: opens the saved file", (await calls(page, "open_file")).at(-1).args.path === "/home/u/Downloads/song.mp3");
await row(12).click({ button: "right" });
const dl5 = await menu(page).getByRole("menuitem").allTextContents();
check("moved: shown but disabled", dl5.some((t) => t.includes("moved or deleted")) && await menu(page).getByRole("menuitem", { name: /moved or deleted/ }).isDisabled());
await page.keyboard.press("Escape");
await row(1).click({ button: "right" });
check("new video: no file actions", !(await menu(page).getByRole("menuitem").allTextContents()).some((t) => t.includes("Open downloaded file")));
await page.keyboard.press("Escape");
await row(4).click({ button: "right" });
check("live: download entries disabled", await menu(page).getByRole("menuitem", { name: "Download video", exact: true }).isDisabled() && await menu(page).getByRole("menuitem", { name: "Download audio (MP3)" }).isDisabled());
await page.keyboard.press("Escape");

// multi-selection menu
for (const n of [1, 2, 5]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${n}$`)).check();
const before = (await calls(page, "start_download")).length;
await row(2).click({ button: "right" });
check("multi: heading + bulk entries", await menu(page).locator(".heading", { hasText: "3 selected videos" }).count() === 1 && await menu(page).getByRole("menuitem", { name: "Download 3 videos", exact: true }).count() === 1);
await menu(page).getByRole("menuitem", { name: "Download 3 videos (720p)", exact: true }).click();
await page.waitForFunction((b) => window.__mock.calls.filter((c) => c.cmd === "start_download").length >= b + 3, before, { timeout: 15000 });
const bulk = (await calls(page, "start_download")).slice(before).map((c) => c.args.req);
check("multi: queues all ticked at 720p", bulk.length === 3 && bulk.every((r) => r.preset === "p720"));
check("multi: selection cleared", await page.getByRole("region", { name: "Selected videos" }).count() === 0);
await row(10).click({ button: "right" });
check("multi: an unticked row gets the single-item menu", await menu(page).getByRole("menuitem", { name: "Show details", exact: true }).count() === 1);
await page.keyboard.press("Escape");

// empty area
await results(page).locator("thead").click({ button: "right", position: { x: 40, y: 8 } });
check("table header: no item menu", await menu(page).getByRole("menuitem", { name: "Show details" }).count() === 0);
await page.keyboard.press("Escape");
await results(page).getByRole("button", { name: "Show more results" }).click({ button: "right" });
const blank = (await menu(page).getByRole("menuitem").allTextContents()).map((t) => t.trim());
check("empty area: select-all menu", blank.includes("Select all") && blank.includes("Deselect all"));
await menu(page).getByRole("menuitem", { name: "Select all", exact: true }).click();
check("empty area: Select all works", await page.getByRole("region", { name: "Selected videos" }).locator("text=12 selected").count() === 1);
await results(page).getByLabel("Select all").uncheck();

// keyboard
await page.bringToFront();
await results(page).getByRole("button", { name: /result 2$/ }).focus();
await page.keyboard.press("ContextMenu");
check("keyboard: Menu key opens it", await menu(page).count() === 1);
await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Show details", null, { timeout: 5000 }).catch(() => {});
const activeText = await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.textContent?.trim()?.slice(0, 40)} focus=${document.hasFocus()} menus=${document.querySelectorAll("[role=menu]").length}`);
check("keyboard: first item focused", activeText.includes("BUTTON:Show details"), activeText);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
check("keyboard: arrows move (skipping headings/separators)", (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Download video (720p)");
await page.keyboard.press("End");
check("keyboard: End jumps to last", (await page.evaluate(() => document.activeElement?.textContent?.trim())).startsWith("Search"));
await page.keyboard.press("Home");
await page.keyboard.press("Enter");
check("keyboard: Enter activates", await menu(page).count() === 0 && (await calls(page, "get_media_info")).at(-1).args.url.endsWith("vid00000001"));
await results(page).getByRole("button", { name: /result 3$/ }).focus();
await page.keyboard.press("Shift+F10");
check("keyboard: Shift+F10 also opens it", await menu(page).count() === 1);
await page.keyboard.press("Escape");

// every layout
for (const view of ["Grid view", "List view", "Compact view"]) {
  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: view }).click();
  const item = results(page).locator("ul > li").nth(1);
  await item.click({ button: "right" });
  check(`layouts: right-click works in ${view}`, await menu(page).getByRole("menuitem", { name: "Download video", exact: true }).count() === 1);
  await page.keyboard.press("Escape");
}

console.log("page errors:", errors);
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 || errors.length > 0 ? 1 : 0;
await browser.close();
