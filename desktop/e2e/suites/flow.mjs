import { fileAction, BASE_URL, browser } from "../harness.mjs";
const errors = [];
let failed = 0, passed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; if (!ok) console.log("FAIL", name); };
const now = Date.now();
const HISTORY = [
  { id: "h1", url: "https://www.youtube.com/watch?v=pasted00001", title: "Pasted Video One", thumbnail: "", preset: "best", path: "/home/u/Downloads/one.mp4", timestamp: now - 1000 },
  { id: "h2", url: "https://www.youtube.com/watch?v=pasted00001", title: "Pasted Video One", thumbnail: "", preset: "audio", path: "/home/u/Downloads/one.mp3", timestamp: now - 2000 },
  { id: "h3", url: "https://www.youtube.com/watch?v=gone0000001", title: "Moved Away Clip", thumbnail: "", preset: "p720", path: "/home/u/Downloads/gone.mp4", timestamp: now - 3000 },
  { id: "h4", url: "https://www.youtube.com/watch?v=vid00000002", title: "Searchable Song", thumbnail: "", preset: "audio", path: "/home/u/Downloads/song.mp3", timestamp: now - 4000 },
];
async function open({ mode = "simple", history = HISTORY, ready = true, mock = {}, store = { warnDuplicates: false } } = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1060, height: 800 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(([m, h, r, mk, st]) => {
    window.__mock = { ready: r, calls: [], dlDelay: 120, missing: ["/home/u/Downloads/gone.mp4"], setupDelay: 100, ...mk };
    if (!localStorage.getItem("__store")) localStorage.setItem("__store", JSON.stringify({ settings: { mode: m, tourSeen: true, ...st }, history: h }));
  }, [mode, history, ready, mock, store]);
  await page.goto(BASE_URL);
  return page;
}
const calls = (page, cmd) => page.evaluate((c) => window.__mock.calls.filter((x) => x.cmd === c), cmd);
const waitCalls = (page, cmd, n, t = 30000) => page.waitForFunction(([c, k]) => window.__mock.calls.filter((x) => x.cmd === c).length >= k, [cmd, n], { timeout: t });
const box = (page) => page.getByLabel("Search YouTube or paste a link");
const nav = (page, name) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) });
const go = async (page, name) => nav(page, name).click();
const lcd = (page) => page.getByLabel("Status display");
const search = async (page, q) => { await box(page).fill(q); await box(page).press("Enter"); };
const details = (page) => page.locator("section[aria-label='Video details']");
const results = (page) => page.locator("section[aria-label='Search results']");

// ============ first run / setup ============
let page = await open({ ready: false });
await page.waitForSelector("text=Let's get Kaisu ready");
check("setup: shown on a fresh machine", await page.getByRole("dialog", { name: "Set up Kaisu" }).count() === 1);
await page.getByRole("button", { name: "Set up automatically" }).click();
await page.waitForSelector("text=Downloading the media converter…");
await page.getByRole("navigation", { name: "Sections" }).waitFor({ timeout: 20000 });
check("setup: lands in the main window", await page.getByLabel("Status display").count() === 1);
check("setup: no redundant update check right after install", (await calls(page, "update_engine")).length === 0);

page = await open({ ready: false, mock: { failAt: "ffmpeg" } });
await page.getByRole("button", { name: "Set up automatically" }).click();
await page.waitForSelector("text=Couldn't reach the download server");
await page.getByRole("button", { name: "Try again" }).click();
await page.getByRole("navigation", { name: "Sections" }).waitFor({ timeout: 20000 });
check("setup: failure then retry succeeds", true);

page = await open({ ready: false, mock: { os: "windows" } });
await page.waitForSelector("text=Let's get Kaisu ready");
await page.locator("summary", { hasText: "Prefer to install them yourself?" }).click();
check("setup: windows steps", await page.locator("text=winget install DenoLand.Deno").count() === 1 && await page.locator("text=sudo dnf").count() === 0);

page = await open({ ready: false, mock: { partial: true } });
await page.getByRole("button", { name: "Skip for now" }).click();
check("setup: skip → warning banner with Fix now", await page.locator("text=Some helper tools are missing").count() >= 1);
await page.getByRole("button", { name: "Fix now" }).click();
await page.getByRole("button", { name: "Set up automatically" }).click();
await page.getByRole("navigation", { name: "Sections" }).waitFor({ timeout: 20000 });
check("setup: fix now completes and clears the banner", await page.locator("text=Some helper tools are missing, so").count() === 0);

// ============ shell ============
page = await open();
await page.waitForSelector("input[type=text]");
check("shell: sidebar sections", (await Promise.all(["Search", "Downloads", "History", "Settings"].map((n) => nav(page, n).count()))).every((c) => c === 1));
check("shell: History badge shows 4", await nav(page, "History").locator(".count", { hasText: "4" }).count() === 1);
check("shell: search page is current", (await nav(page, "Search").getAttribute("aria-current")) === "page");
check("shell: display idle text", await lcd(page).locator("text=Paste a link or search YouTube").count() === 1);
check("shell: empty state", await page.getByRole("heading", { name: "What would you like to download?", exact: true }).count() === 1);
check("shell: no header mode toggle", await page.locator("[aria-label='Interface mode']").count() === 0);
check("shell: search box focused on launch", await box(page).evaluate((e) => document.activeElement === e));

// ============ search → results ============
await search(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
check("search: query sent with page size 12", (await calls(page, "search_media")).at(-1).args.limit === 12);
check("search: table is the default layout", await results(page).locator("table.itable").count() === 1 && await results(page).locator("tbody tr").count() === 12);
check("search: column headers", (await results(page).locator("thead th").allTextContents()).join("|").includes("Name") && (await results(page).locator("thead th").allTextContents()).join("|").includes("Channel"));
check("search: LIVE row", await results(page).locator("tr", { hasText: "result 4" }).locator("text=LIVE").count() === 1);
check("search: status bar counts results", await page.locator("footer").locator("text=12 results").count() === 1);
check("search: nothing inspected yet", (await calls(page, "get_media_info")).length === 0);
check("search: downloaded status on known video", await results(page).locator("tr", { hasText: "result 3" }).locator("text=Downloaded").count() === 1);

// select a result → details
await results(page).getByRole("button", { name: /lofi beats — result 2/ }).click();
await details(page).waitFor();
check("details: inspected exactly once", (await calls(page, "get_media_info")).length === 1);
check("details: sidebar artwork + caption", await page.getByLabel("Artwork").locator("img").count() === 1 && await page.getByLabel("Artwork").locator("text=Big Buck Bunny").count() === 1);
check("details: views, likes, date", await details(page).locator("text=1.2M views").count() === 1 && await details(page).locator("text=45.2K").count() === 1 && await details(page).locator("text=May 30, 2014").count() === 1);
check("details: chooser open for a new video", await details(page).getByRole("radio", { name: /Video/ }).count() === 1);
check("details: size estimates", await details(page).locator("text=MP4 · up to 1080p · ~94 MB").count() === 1 && await details(page).locator("text=/MP3 · ~3.1 MB/").count() === 1);
check("details: selected row highlighted", (await results(page).locator("tr.sel").count()) === 1);
await details(page).getByRole("radio", { name: /Audio only/ }).click();
await details(page).getByRole("button", { name: "Download audio" }).click();
await details(page).locator("text=Download started").waitFor();
check("details: collapses after starting", await details(page).getByRole("radio", { name: /Audio only/ }).count() === 0);
check("downloads badge appears", await nav(page, "Downloads").locator(".count").count() === 1);
await waitCalls(page, "start_download", 1);
check("audio request", (await calls(page, "start_download")).at(-1).args.req.preset === "audio");
await page.waitForFunction(() => document.querySelector("[aria-label='Status display']")?.textContent?.includes("Big Buck Bunny"), null, { timeout: 5000 }).then(() => check("display shows the active download", true)).catch(() => check("display shows the active download", false));

// ============ multi-select ============
await results(page).getByLabel(/^Select lofi beats — result 1$/).check();
await results(page).getByLabel(/^Select lofi beats — result 5$/).check();
const bar = page.getByRole("region", { name: "Selected videos" });
check("multi: bar shows count", await bar.locator("text=2 selected").count() === 1);
check("multi: status bar mentions selection", await page.locator("footer").locator("text=2 selected").count() === 1);
await bar.getByLabel("Video quality").selectOption("p720");
await bar.getByRole("button", { name: "Download 2 videos" }).click();
await waitCalls(page, "start_download", 3);
const batch = (await calls(page, "start_download")).slice(1).map((c) => c.args.req);
check("multi: queued with chosen quality", batch.length >= 2 && batch.every((r) => r.preset === "p720"));
check("multi: right videos", JSON.stringify(batch.map((r) => r.url.slice(-11)).sort()) === JSON.stringify(["vid00000000", "vid00000004"]));
check("multi: selection cleared + banner", await bar.count() === 0 && await page.locator("text=Added 2 video downloads to the queue.").count() === 1);
await results(page).getByLabel("Select all").check();
check("multi: select all", await bar.locator("text=12 selected").count() === 1);
await results(page).getByLabel("Select all").uncheck();

// ============ views ============
const layout = page.getByRole("radiogroup", { name: "Layout" });
for (const [view, probe] of [["Grid view", "ul.grid"], ["List view", "ul.flex-col"], ["Compact view", "ul.gap-1"], ["Details view", "table.itable"]]) {
  await layout.getByRole("radio", { name: view }).click();
  check(`views: search ${view}`, await results(page).locator(probe).count() >= 1);
  const tick = results(page).getByLabel(/^Select lofi beats — result 6$/);
  await tick.check(); const ok = await bar.locator("text=1 selected").count() === 1; await tick.uncheck();
  check(`views: ${view} multi-select works`, ok);
}
await layout.getByRole("radio", { name: "Grid view" }).click();
await page.reload();
await page.getByRole("button", { name: "Remove them" }).click({ timeout: 1500 }).catch(() => {});   // downloads cut off by the reload come back paused
await search(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
check("views: choice persisted", (await results(page).locator("ul.grid").count()) === 1);
await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: "Details view" }).click();

// search extras
await results(page).getByRole("button", { name: "Show more results" }).click();
await page.waitForSelector("text=lofi beats — result 24");
check("search: show more asks for 24", (await calls(page, "search_media")).at(-1).args.limit === 24);
await search(page, "--exec calc");
await page.waitForSelector("text=--exec calc — result 1");
check("search: option-like text is just a query", (await calls(page, "search_media")).at(-1).args.query === "--exec calc");
await search(page, "nothing here");
await page.waitForSelector("text=No videos found");
await search(page, "boom");
await page.waitForSelector("text=Couldn't connect.");
check("search: friendly error", true);

// ============ pasted link, downloaded state ============
await search(page, "https://www.youtube.com/watch?v=pasted00001");
await details(page).waitFor();
check("link: Enter inspects it", (await calls(page, "get_media_info")).at(-1).args.url.endsWith("pasted00001"));
check("downloaded: lists both files", await details(page).locator("ul[aria-label='Already downloaded'] li").count() === 2);
check("downloaded: chooser tucked away", await details(page).getByRole("radio", { name: /Video/ }).count() === 0 && (await details(page).getByRole("button", { name: "Download again" }).getAttribute("aria-expanded")) === "false");
await details(page).getByRole("button", { name: "Open file" }).first().click();
await page.waitForTimeout(150);
check("downloaded: Open uses the newest file", (await calls(page, "open_file")).at(-1)?.args.path === "/home/u/Downloads/one.mp4");
await details(page).getByRole("button", { name: "Download again" }).click();
check("downloaded: dropdown reveals choices", await details(page).getByRole("radio", { name: /Audio only/ }).count() === 1);
await search(page, "https://www.youtube.com/watch?v=gone0000001");
await page.waitForSelector("ul[aria-label='Already downloaded']");
check("downloaded: moved file → warning, no Open", await page.locator("ul[aria-label='Already downloaded'] >> text=File moved or deleted").count() === 1 && await page.locator("ul[aria-label='Already downloaded']").getByRole("button", { name: "Open file" }).count() === 0);

// finishing a download → card flips to "downloaded"
await search(page, "https://www.youtube.com/watch?v=brandnew0001");
await details(page).getByRole("heading", { name: /Big Buck Bunny/ }).waitFor();
await details(page).getByRole("button", { name: "What would you like to download?" }).click();
await details(page).getByRole("button", { name: "What would you like to download?" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await page.waitForSelector("ul[aria-label='Already downloaded']", { timeout: 15000 });
check("finish: card now shows the file with Open", await page.locator("ul[aria-label='Already downloaded']").getByRole("button", { name: "Open file" }).count() === 1);

// ============ downloads page ============
await go(page, "Downloads");
check("downloads: table with progress column", await page.locator("table.itable thead th", { hasText: "Progress" }).count() === 1);
check("downloads: progress bars", await page.locator("[role=progressbar]").count() >= 1);
check("downloads: count in status bar", await page.locator("footer").locator("text=/\\d+ downloads?/").count() === 1);
await page.waitForFunction(() => !document.querySelector("[aria-label='Status display']")?.textContent?.includes("Downloads ·"), null, { timeout: 60000 }).catch(() => {});
await page.locator("tr", { hasText: "Done" }).first().waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "Open file" }).first().click();
await page.waitForTimeout(150);
check("downloads: Open on a finished download", (await calls(page, "open_file")).at(-1)?.args.path.endsWith("Big Buck Bunny [aqz-KE-bpKQ].mp4"));
for (const [v, probe] of [["Grid view", "div.grid"], ["List view", ".row-card"], ["Compact view", ".row-card"], ["Details view", "table.itable"]]) {
  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: v }).click();
  check(`downloads: ${v}`, await page.locator(probe).count() >= 1);
}
await page.evaluate(() => (window.__mock.missing = ["/home/u/Downloads/gone.mp4", "/home/u/Downloads/Big Buck Bunny [aqz-KE-bpKQ].mp4"]));
await page.getByRole("button", { name: "Open file" }).first().click();
await page.waitForSelector("text=That file has been moved or deleted.");
check("downloads: moved file → banner", true);
await page.getByRole("button", { name: "Clear finished" }).click();
check("downloads: clear finished", await page.locator("text=No downloads").count() === 1);

// ============ history ============
await go(page, "History");
check("history: table", await page.locator("table.itable tbody tr").count() >= 4);
const row = (t) => page.locator("tr", { hasText: t }).first();
check("history: Open labelled", await row("Searchable Song").getByRole("button", { name: "Open file" }).locator("text=Open").count() === 1);
await row("Searchable Song").getByRole("button", { name: "Open file" }).click();
await fileAction(row("Searchable Song"), "Show in folder");
await page.waitForTimeout(150);
check("history: open + reveal", (await calls(page, "open_file")).at(-1)?.args.path === "/home/u/Downloads/song.mp3" && (await calls(page, "reveal_file")).at(-1)?.args.path === "/home/u/Downloads/song.mp3");
check("history: moved file flagged", await row("Moved Away Clip").locator("svg").count() >= 1 && await row("Moved Away Clip").getByRole("button", { name: "Open file" }).count() === 0);
await row("Searchable Song").getByRole("button", { name: /Download .* again/ }).click();
check("history: chooser expands", await page.locator("[aria-label='Download again options']").count() === 1);
await page.getByRole("radio", { name: /Audio/ }).click();
await page.locator("[aria-label='Download again options']").getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 8, 15000).catch(() => {});
check("history: download again as audio, stays on History", (await nav(page, "History").getAttribute("aria-current")) === "page" && (await calls(page, "start_download")).at(-1).args.req.preset === "audio");
await page.getByLabel("Filter history").fill("pasted");
check("history: title filter", await page.locator("tbody tr").count() === 2);
await page.getByLabel("Filter history").fill("");
await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "audio" }).click();
const fmts = await page.locator("tbody tr td:nth-child(4)").allTextContents();
check("history: audio filter shows only audio", fmts.length >= 2 && fmts.every((f) => /Audio/.test(f)));
await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "all" }).click();
for (const [v, probe] of [["Grid view", "ul.grid"], ["Compact view", "ul.gap-1"], ["List view", "ul.flex-col"], ["Details view", "table.itable"]]) {
  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: v }).click();
  check(`history: ${v}`, await page.locator(probe).count() >= 1);
}
check("history: status bar", await page.locator("footer").locator("text=/\\d+ items?/").count() === 1);

// ============ settings & advanced ============
await go(page, "Settings"); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
check("settings: its own page", await page.locator("h1:has-text('Settings')").count() === 1 && await box(page).count() === 1);
check("settings: simple hides advanced", await page.locator("section[aria-label='Advanced options']").count() === 0);
await page.getByRole("radio", { name: /^advanced/i }).click();
check("settings: advanced shows options", await page.locator("section[aria-label='Advanced options']").count() === 1);
check("settings: engine indicator in status bar", await page.locator("footer").locator("text=yt-dlp 2026.08.19").count() === 1);
await page.getByLabel("Speed limit").fill("2M");
await page.getByLabel("Custom yt-dlp arguments").fill("--embed-chapters");
await page.getByLabel("Audio format").selectOption("flac");
await page.getByRole("button", { name: "Repair" }).click();
await page.waitForSelector("text=Let's get Kaisu ready");
check("settings: Repair opens setup", true);
await page.reload();
await page.getByRole("button", { name: "Remove them" }).click({ timeout: 1500 }).catch(() => {});   // downloads cut off by the reload come back paused
await page.waitForSelector("input[type=text]");
check("settings: advanced mode persisted across reload", await page.locator("footer").locator("text=yt-dlp 2026.08.19").count() === 1);

await search(page, "https://www.youtube.com/watch?v=adv00000001");
await details(page).waitFor();
check("advanced: stream picker", await details(page).locator("summary:has-text('Choose exact streams')").count() === 1);
await details(page).locator("summary:has-text('Choose exact streams')").click();
await details(page).getByLabel("Video stream").selectOption("137");
await details(page).getByLabel("Audio stream").selectOption("140");
check("advanced: format selector", await details(page).locator("text=137+140").count() >= 1);
check("advanced: active options summary", await details(page).locator("text=limit 2M/s").count() === 1);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
const adv = (await calls(page, "start_download")).at(-1).args.req;
check("advanced: request carries format + options", adv.extra.format_id === "137+140" && adv.extra.rate_limit === "2M" && adv.extra.custom_args === "--embed-chapters" && adv.extra.verbose === true);
await go(page, "Downloads");
check("advanced: per-download log", await page.locator("tr", { hasText: "Big Buck Bunny" }).first().locator("button[aria-expanded]").count() === 1);

// simple ignores advanced
await go(page, "Settings"); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await page.getByRole("radio", { name: /^simple/i }).click();
await search(page, "https://www.youtube.com/watch?v=simple000001");
await details(page).getByRole("heading", { name: /Big Buck Bunny/ }).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 2);
const simple = (await calls(page, "start_download")).at(-1).args.req;
check("simple: ignores saved advanced settings", simple.extra.rate_limit === null && simple.extra.custom_args === null && simple.extra.format_id === null && simple.extra.verbose === false);

// friendly errors in simple mode
await search(page, "https://www.youtube.com/watch?v=private");
await page.waitForSelector("text=This video needs you to be signed in.");
await page.locator("text=Show technical details").first().click();
check("simple: friendly error + technical details", await page.locator("text=Sign in to confirm your age").count() === 1);

console.log("page errors:", errors);
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 || errors.length > 0 ? 1 : 0;
await browser.close();
