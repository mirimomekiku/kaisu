import { chooseMenu, browser, BASE_URL, open, check, calls, waitCalls, nav, results, details, submit, now, done } from "../harness.mjs";

const VIDEO = "https://www.youtube.com/watch?v=pasted00001";
const anyBox = (page) => page.getByLabel(/^Search .* or paste a link$/);
const lastReq = async (page) => (await calls(page, "start_download")).at(-1).args.req;
const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings);
const card = async (page, url = VIDEO) => { await anyBox(page).fill(url); await anyBox(page).press("Enter"); await details(page).waitFor(); };
const adv = { mode: "advanced" };
const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort()));

// ================= first-run tour =================
let page = await open({ store: { tourSeen: false } });
const tour = page.getByRole("dialog", { name: "Quick tour" });
await tour.waitFor();
check("tour: appears on first run", await tour.locator("text=Welcome to Kaisu").count() === 1);
await tour.getByRole("button", { name: "Start tour" }).click();
check("tour: step 2 spotlights the search field", await tour.locator("text=Search or paste a link").count() === 1 && await page.locator(".tour-spot").count() === 1);
await page.keyboard.press("ArrowRight");
check("tour: arrow key moves on", await tour.locator("text=The status display").count() === 1);
await page.keyboard.press("ArrowLeft");
check("tour: arrow key moves back", await tour.locator("text=Search or paste a link").count() === 1);
await page.keyboard.press("Escape");
await tour.waitFor({ state: "detached" });
check("tour: Esc skips it and remembers", (await settingsOf(page)).tourSeen === true);
await page.reload();
await page.waitForSelector("input[type=text]");
await page.waitForTimeout(400);
check("tour: not shown again after a reload", await page.getByRole("dialog", { name: "Quick tour" }).count() === 0);
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await page.getByRole("button", { name: "Show the tour again" }).click();
await tour.waitFor();
let guard = 0;
while (!(await tour.getByRole("button", { name: "Done" }).count()) && guard++ < 10) await page.keyboard.press("Enter");
check("tour: last step says Done", await tour.getByRole("button", { name: "Done" }).count() === 1);
check("tour: the sidebar steps spotlight a real control", await page.locator(".tour-spot").count() === 1);
await tour.getByRole("button", { name: "Done" }).click();
check("tour: finished", await page.getByRole("dialog", { name: "Quick tour" }).count() === 0);
await page.context().close();

{
  const ctx = await browser.newContext({ viewport: { width: 1060, height: 800 } });
  const early = await ctx.newPage();
  await early.addInitScript(() => {
    window.__mock = { ready: false, calls: [], dlDelay: 80, missing: [], setupDelay: 50, notifications: [] };
    localStorage.setItem("__store", JSON.stringify({ settings: { mode: "simple", tourSeen: false }, history: [], queue: [] }));
  });
  await early.goto(BASE_URL);
  await early.waitForSelector("text=Let's get Kaisu ready");
  await early.waitForTimeout(500);
  check("tour: waits until setup is done", await early.getByRole("dialog", { name: "Quick tour" }).count() === 0);
  await ctx.close();
}

// ================= search sources =================
page = await open();
const src = page.getByLabel("Search source");
check("source: picker lists the working sites", JSON.stringify(await src.locator("option").allTextContents()) === JSON.stringify(["YouTube", "SoundCloud", "YouTube Music"]));
check("source: defaults to YouTube", (await src.inputValue()) === "youtube" && (await anyBox(page).getAttribute("placeholder")) === "Search YouTube or paste a link");
await submit(page, "lofi");
await results(page).waitFor();
check("source: YouTube search sends the source", (await calls(page, "search_media")).at(-1).args.source === "youtube");
await src.selectOption("soundcloud");
await waitCalls(page, "search_media", 2);
check("source: changing it repeats the search on the new site", (await calls(page, "search_media")).at(-1).args.source === "soundcloud" && (await calls(page, "search_media")).at(-1).args.query === "lofi");
await page.waitForSelector("text=lofi — result 1 (SC)");
check("source: results come from SoundCloud", await results(page).locator("text=(SC)").count() > 0);
check("source: placeholder and label follow", (await anyBox(page).getAttribute("placeholder")) === "Search SoundCloud or paste a link");
check("source: choice is saved", (await settingsOf(page)).searchSource === "soundcloud");
await results(page).getByLabel(/^Select lofi — result 1 \(SC\)$/).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 1 video" }).click();
await waitCalls(page, "start_download", 1);
check("source: SoundCloud results download like any other", (await lastReq(page)).url === "https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A1000", (await lastReq(page)).url);
await page.reload();
await page.waitForSelector("input[type=text]");
check("source: remembered after a restart", (await page.getByLabel("Search source").inputValue()) === "soundcloud");
await page.context().close();

page = await open({ store: { searchSource: "dailymotion" } });
check("source: an unknown saved source falls back to YouTube", (await page.getByLabel("Search source").inputValue()) === "youtube");
await page.context().close();

// ================= subtitles =================
page = await open({ store: { warnDuplicates: false } });
await card(page);
const subBtn = () => details(page).getByRole("button", { name: /^Subtitles/ });
await details(page).getByRole("button", { name: "What would you like to download?" }).isVisible();
check("subtitles: offered when the video has some", await subBtn().count() === 1);
await subBtn().click();
const sg = () => details(page).getByRole("group", { name: "Subtitles" });
check("subtitles: starts with none", (await sg().getByLabel("Subtitle format").inputValue()) === "off");
check("subtitles: lists manual and automatic tracks", await sg().locator("text=German").count() === 1 && await sg().locator("text=Portuguese (Brazil) (automatic)").count() === 1);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("subtitles: none chosen → none requested", (await lastReq(page)).extra.subs === null);
await page.waitForTimeout(300);
await details(page).getByRole("button", { name: "Download again" }).click();
await sg().getByLabel(/German/).check();
check("subtitles: ticking a language switches subtitles on", (await sg().getByLabel("Subtitle format").inputValue()) === "embed");
check("subtitles: heading summarises the choice", await details(page).getByRole("button", { name: "Subtitles (de)" }).count() === 1);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 2);
let req = await lastReq(page);
check("subtitles: embedded German", sorted(req.extra.subs) === sorted({ langs: ["de"], embed: true, file: false, auto: true }), JSON.stringify(req.extra.subs));
await page.context().close();

page = await open({ store: { warnDuplicates: false } });
await card(page);
await subBtn().click();
await sg().getByLabel("Subtitle format").selectOption("both");
await sg().getByLabel(/English/).check();
await sg().getByLabel(/Portuguese/).check();
await details(page).getByRole("radio", { name: /Audio only/ }).click();
check("subtitles: audio gets a note about .srt files", await sg().locator("text=Audio files can't hold subtitles").count() === 1);
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("subtitles: both + two languages (automatic one flips auto on)", sorted(req.extra.subs) === sorted({ langs: ["en", "pt-BR"], embed: true, file: true, auto: true }) && req.preset === "audio", JSON.stringify(req.extra.subs));
await page.context().close();

page = await open({ mock: { noSubs: true } });
await card(page);
check("subtitles: hidden when the video has none", await subBtn().count() === 0);
await page.context().close();

page = await open({ store: { ...adv, subtitleMode: "file", subtitleLangs: "en, pt", warnDuplicates: false } });
await card(page);
check("subtitles: Advanced defaults preselect matching tracks", await details(page).getByRole("button", { name: "Subtitles (en, pt-BR)" }).count() === 1);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("subtitles: saved as files", sorted(req.extra.subs) === sorted({ langs: ["en", "pt-BR"], embed: false, file: true, auto: true }), JSON.stringify(req.extra.subs));
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
check("subtitles: settings has mode and languages", (await page.getByLabel("Subtitles", { exact: true }).inputValue()) === "file" && (await page.getByLabel("Subtitle languages").inputValue()) === "en, pt");
await page.getByLabel("Subtitles", { exact: true }).selectOption("off");
check("subtitles: language fields hide when off", await page.getByLabel("Subtitle languages").count() === 0);
await page.context().close();

page = await open({ store: { mode: "simple", subtitleMode: "embed", subtitleLangs: "en", warnDuplicates: false } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("subtitles: Simple mode ignores the Advanced defaults", (await lastReq(page)).extra.subs === null);
await page.context().close();

page = await open({ store: { subtitles: true } });
check("subtitles: old settings still load", true);
await page.context().close();

// ================= proxy =================
page = await open({ store: { warnDuplicates: false } });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
const proxy = page.getByLabel("Proxy", { exact: true });
check("proxy: Network section is there in Simple mode too", await page.locator("section[aria-label='Network']").count() === 1);
check("proxy: test button waits for an address", await page.getByRole("button", { name: "Test proxy" }).isDisabled());
await proxy.fill("socks5://127.0.0.1:1080");
await page.getByRole("button", { name: "Test proxy" }).click();
await page.getByRole("status").filter({ hasText: "The proxy works." }).waitFor();
check("proxy: test reports success", true);
check("proxy: test sent the address", (await calls(page, "test_proxy")).at(-1).args.proxy === "socks5://127.0.0.1:1080");
await proxy.fill("socks5://bad.example:1");
await page.getByRole("button", { name: "Test proxy" }).click();
await page.getByRole("alert").filter({ hasText: "Couldn't connect through the proxy" }).waitFor();
check("proxy: test reports the failure", true);
await proxy.fill("socks5://127.0.0.1:1080");
check("proxy: result clears when the address changes", await page.getByRole("alert").filter({ hasText: "Couldn't connect" }).count() === 0);
check("proxy: saved", (await settingsOf(page)).proxy === "socks5://127.0.0.1:1080");
await nav(page, "Search").click();
await submit(page, "lofi");
await results(page).waitFor();
check("proxy: search goes through it", (await calls(page, "search_media")).at(-1).args.proxy === "socks5://127.0.0.1:1080");
await card(page);
check("proxy: look-ups go through it", (await calls(page, "get_media_info")).at(-1).args.proxy === "socks5://127.0.0.1:1080");
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("proxy: downloads go through it (Simple mode)", (await lastReq(page)).extra.proxy === "socks5://127.0.0.1:1080");
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await proxy.fill("");
await nav(page, "Search").click();
await submit(page, "again");
await waitCalls(page, "search_media", 2);
check("proxy: cleared means none", (await calls(page, "search_media")).at(-1).args.proxy === null);
await page.context().close();

// ================= bandwidth schedule =================
page = await open({ store: { ...adv, warnDuplicates: false } });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
const sched_ = () => page.locator("section[aria-label='Bandwidth schedule']");
check("schedule: Advanced shows the section", await sched_().count() === 1);
check("schedule: nothing applies at first", await sched_().locator("text=no rule applies").count() === 1);
await sched_().getByRole("button", { name: "Add a rule" }).click();
check("schedule: a rule starts as a weekday office-hours limit", (await sched_().getByLabel("From (rule 1)").inputValue()) === "09:00" && await sched_().locator("text=Mon-Fri 09:00-17:00: limit to 500K").count() === 1);
for (const d of ["Sun", "Sat"]) await sched_().getByLabel(`${d} (rule 1)`).check();
await sched_().getByLabel("From (rule 1)").fill("00:00");
await sched_().getByLabel("To (rule 1)").fill("00:00");
check("schedule: all-day every-day limit is active now", await sched_().locator("text=limited to 500K/s").count() === 1);
check("schedule: saved", (await settingsOf(page)).schedule.length === 1);
await nav(page, "Search").click();
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("schedule: the limit applies to a new download", (await lastReq(page)).extra.rate_limit === "500K");
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await sched_().getByLabel("Speed limit (rule 1)").fill("abc");
check("schedule: a bad limit is flagged and not used", await sched_().getByRole("alert").locator("text=Speed limit must look like").count() === 1 && await sched_().locator("text=no rule applies").count() === 1);
await sched_().getByLabel("Speed limit (rule 1)").fill("2M");
await sched_().getByLabel("Action (rule 1)").selectOption("pause");
check("schedule: pause rule says so", await sched_().locator("text=downloads are paused").count() === 1);
await nav(page, "Search").click();
await page.waitForTimeout(300);
await nav(page, "Downloads").click().catch(() => {});
await page.context().close();

// a pause rule holds new downloads back, and ending it releases them
page = await open({ store: { ...adv, warnDuplicates: false, schedule: [{ id: "r1", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "00:00", action: "pause", limit: "" }] } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await nav(page, "Downloads").click();
await page.waitForTimeout(1200);
check("schedule: pause rule keeps the download from starting", (await calls(page, "start_download")).length === 0);
await page.locator(".lcd").locator("text=Paused by your schedule").waitFor({ timeout: 8000 }).catch(() => {});
check("schedule: the display says why", await page.locator(".lcd").locator("text=Paused by your schedule").count() === 1);
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await page.getByRole("button", { name: "Delete rule 1" }).click();
await nav(page, "Downloads").click();
await waitCalls(page, "start_download", 1);
await page.waitForSelector(".progress.done", { timeout: 15000 });
check("schedule: ending the rule lets it run to completion", true);
await page.context().close();

// a pause rule that begins while a download runs stops it, and it carries on afterwards
page = await open({ store: { ...adv, warnDuplicates: false }, mock: { dlDelay: 400 } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await sched_().getByRole("button", { name: "Add a rule" }).click();
for (const d of ["Sun", "Sat"]) await sched_().getByLabel(`${d} (rule 1)`).check();
await sched_().getByLabel("From (rule 1)").fill("00:00");
await sched_().getByLabel("To (rule 1)").fill("00:00");
await sched_().getByLabel("Action (rule 1)").selectOption("pause");
await waitCalls(page, "cancel_download", 1);
await nav(page, "Downloads").click();
await page.getByText(/Paused at/).waitFor({ timeout: 8000 });
check("schedule: a running download is paused when a pause rule begins", true);
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await page.getByRole("button", { name: "Delete rule 1" }).click();
await waitCalls(page, "start_download", 2, 15000);
await nav(page, "Downloads").click();
await page.waitForSelector(".progress.done", { timeout: 30000 });
check("schedule: …and resumes by itself when it ends", true);
await page.context().close();

// a limit rule that begins while a download runs restarts it with the new speed
page = await open({ store: { ...adv, warnDuplicates: false }, mock: { dlDelay: 400 } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("schedule: no limit before the rule", (await lastReq(page)).extra.rate_limit === null);
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await sched_().getByRole("button", { name: "Add a rule" }).click();
for (const d of ["Sun", "Sat"]) await sched_().getByLabel(`${d} (rule 1)`).check();
await sched_().getByLabel("From (rule 1)").fill("00:00");
await sched_().getByLabel("To (rule 1)").fill("00:00");
await waitCalls(page, "start_download", 2, 15000);
check("schedule: a new limit restarts the running download with it", (await lastReq(page)).extra.rate_limit === "500K");
await page.context().close();

// Simple mode doesn't use the schedule
page = await open({ store: { warnDuplicates: false, schedule: [{ id: "r1", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "00:00", action: "pause", limit: "" }] } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("schedule: Simple mode ignores it", true);
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
check("schedule: Simple mode doesn't show it", await page.locator("section[aria-label='Bandwidth schedule']").count() === 0);
await page.context().close();

// ================= history =================
const D = "/home/u/Downloads";
const H = (id, title, channel, preset, ago, extra = {}) => ({ id, url: `https://www.youtube.com/watch?v=${id.padEnd(11, "0")}`, title, thumbnail: "", preset, path: `${D}/${id}.${preset === "audio" ? "mp3" : "mp4"}`, timestamp: now - ago * 3600_000, channel, ...extra });
const HISTORY = [
  H("aaa", "Alpha video", "Zed Channel", "best", 1),
  H("bbb", "Bravo song", "Amy Music", "audio", 2),
  H("ccc", "Charlie clip", "Zed Channel", "best", 3, { clip: "80-165" }),
  H("ddd", "Delta gone", "Bob", "p720", 4),
  H("eee", "=Echo formula", "Bob", "best", 5),
];
const MOCK = { missing: [`${D}/ddd.mp4`], sizes: { [`${D}/aaa.mp4`]: 5_000_000, [`${D}/bbb.mp3`]: 3_000_000, [`${D}/ccc.mp4`]: 9_000_000, [`${D}/eee.mp4`]: 1_000_000 } };
page = await open({ history: HISTORY, mock: MOCK, store: { warnDuplicates: false } });
await nav(page, "History").click();
const titles = async () => (await page.locator("table.itable tbody tr td:nth-child(2) span.truncate").allTextContents());
await page.waitForSelector("table.itable");
check("history: newest first by default", (await titles())[0] === "Alpha video" && (await titles()).at(-1) === "=Echo formula", JSON.stringify(await titles()));
check("history: sizes shown", await page.locator("td", { hasText: "9.0 MB" }).count() === 1 || await page.locator("td", { hasText: /9(\.0)? MB/ }).count() === 1);
check("history: channel column", await page.locator("td", { hasText: "Amy Music" }).count() === 1);
check("history: status bar totals", await page.locator("footer").locator("text=/5 items, .*MB/").count() === 1, await page.locator("footer").innerText());
const th = (name) => page.getByRole("columnheader", { name });
await th(/^Name/).getByRole("button").click();
check("history: click Name sorts A-Z", (await titles())[0] === "=Echo formula" && (await th(/^Name/).getAttribute("aria-sort")) === "ascending", JSON.stringify(await titles()));
await th(/^Name/).getByRole("button").click();
check("history: click again reverses", (await titles())[0] === "Delta gone" && (await th(/^Name/).getAttribute("aria-sort")) === "descending");
check("history: sort is saved", (await settingsOf(page)).historySort === "title" && (await settingsOf(page)).historySortDesc === true);
await th(/^Size/).getByRole("button").click();
check("history: size sorts biggest first", (await titles())[0] === "Charlie clip", JSON.stringify(await titles()));
await page.getByLabel("Sort by").selectOption("channel");
check("history: sort menu works too", (await th(/^Channel/).getAttribute("aria-sort")) !== "none");
await page.getByLabel("Sort by").selectOption("date");
await page.getByRole("button", { name: /Sorted/ }).click();
check("history: direction toggle", (await titles())[0] === "=Echo formula", JSON.stringify(await titles()));
await page.getByRole("button", { name: /Sorted/ }).click();

await page.getByLabel("Filter history").fill("zed");
check("history: filter matches the channel", (await titles()).length === 2);
await page.getByLabel("Filter history").fill("");
await page.getByLabel("Files").selectOption("missing");
check("history: show only missing files", JSON.stringify(await titles()) === JSON.stringify(["Delta gone"]));
await page.getByLabel("Files").selectOption("present");
check("history: show only present files", (await titles()).length === 4 && !(await titles()).includes("Delta gone"));
await page.getByLabel("Files").selectOption("all");

// selection + bulk actions
await page.getByLabel('Select "Alpha video"').check();
await page.getByLabel('Select "Bravo song"').check();
const bulk = page.getByRole("toolbar", { name: "Selected items" });
check("history: bulk bar counts the selection", await bulk.locator("text=2 selected").count() === 1);
await chooseMenu(page, "History actions", "Export CSV");
await page.waitForFunction(() => window.__mock.exports?.length === 1);
let exp = await page.evaluate(() => window.__mock.exports[0]);
check("history: CSV export of the selection only", exp.path === "/home/u/export.csv" && exp.contents.includes("Alpha video") && exp.contents.includes("Bravo song") && !exp.contents.includes("Charlie"), exp.contents);
check("history: CSV has header, channel and size", exp.contents.startsWith("Title,Channel,Format,Clip,Downloaded,Size (bytes),File,Link") && exp.contents.includes("Amy Music") && exp.contents.includes("3000000"));
await bulk.getByRole("button", { name: "Select none" }).click();
check("history: select none hides the bar", await bulk.count() === 0);
await chooseMenu(page, "History actions", "Export JSON");
await page.waitForFunction(() => window.__mock.exports?.length === 2);
exp = await page.evaluate(() => window.__mock.exports[1]);
const parsed = JSON.parse(exp.contents);
check("history: JSON export of everything shown", parsed.length === 5 && parsed.some((r) => r.title === "Delta gone" && r.file === null && r.fileExists === false));
await chooseMenu(page, "History actions", "Export CSV");
await page.waitForFunction(() => window.__mock.exports?.length === 3);
exp = await page.evaluate(() => window.__mock.exports[2]);
check("history: formulas are defused in CSV", exp.contents.includes("'=Echo formula") && !exp.contents.includes(",=Echo") && !exp.contents.startsWith("=Echo") && !/\n=Echo/.test(exp.contents));
await page.evaluate(() => (window.__mock.exportFail = true));
await chooseMenu(page, "History actions", "Export CSV");
await page.getByRole("status").filter({ hasText: "Couldn't save the file" }).waitFor();
check("history: a failed export says so", true);
await page.evaluate(() => (window.__mock.exportFail = false));

await nav(page, "History").click();
await page.getByLabel('Select "Bravo song"').check();
await bulk.getByRole("button", { name: "Remove from history" }).click();
check("history: bulk remove", !(await titles()).includes("Bravo song") && (await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).history.length)) === 4);
await chooseMenu(page, "History actions", "Remove 1 missing");
check("history: remove missing", !(await titles()).includes("Delta gone") && (await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).history.length)) === 3);
check("history: no 'remove missing' button once none are missing", await page.getByRole("button", { name: /missing$/ }).count() === 0);
const before = (await calls(page, "file_info")).length;
await page.evaluate((p) => (window.__mock.missing = [p]), `${D}/aaa.mp4`);
await chooseMenu(page, "History actions", "Check files");
await page.waitForFunction((n) => window.__mock.calls.filter((c) => c.cmd === "file_info").length > n, before);
await page.getByRole("button", { name: "History actions", exact: true }).click();
await page.getByRole("menuitem", { name: "Remove 1 missing", exact: true }).waitFor();
check("history: Check files re-checks the disk", true);
await page.context().close();

page = await open({ history: HISTORY, mock: MOCK, store: { warnDuplicates: false } });
await nav(page, "History").click();
await page.waitForSelector("table.itable");
await page.getByLabel("Select all shown").first().check();
check("history: select all shown", await page.getByRole("toolbar", { name: "Selected items" }).locator("text=5 selected").count() === 1);
await page.getByRole("toolbar", { name: "Selected items" }).getByRole("button", { name: "Download again" }).click();
await waitCalls(page, "start_download", 4);
const reqs = (await calls(page, "start_download")).map((c) => c.args.req);
check("history: bulk download again skips clips, keeps formats", reqs.length === 4 && reqs.some((r) => r.preset === "audio") && reqs.some((r) => r.preset === "p720") && !reqs.some((r) => /ccc/.test(r.url)), JSON.stringify(reqs.map((r) => [r.url, r.preset])));
await page.context().close();

// other layouts get the same selection and sorting
page = await open({ history: HISTORY, mock: MOCK, store: { viewHistory: "list" } });
await nav(page, "History").click();
await page.getByLabel('Select "Alpha video"').check();
check("history: list view can select too", await page.getByRole("toolbar", { name: "Selected items" }).locator("text=1 selected").count() === 1);
check("history: list view shows channel and size", await page.locator("li", { hasText: "Alpha video" }).locator("text=Zed Channel").count() === 1);
await page.context().close();

await done();
