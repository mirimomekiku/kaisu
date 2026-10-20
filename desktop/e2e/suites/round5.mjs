import { browser, BASE_URL, open, check, calls, waitCalls, nav, details, submit, now, done } from "../harness.mjs";

const anyBox = (page) => page.getByLabel(/^Search .* or paste a link$/);
const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings);
const historyOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).history);
const card = async (page, url = "https://www.youtube.com/watch?v=pasted00001") => { await anyBox(page).fill(url); await anyBox(page).press("Enter"); await details(page).waitFor(); };
const adv = { mode: "advanced" };
const DL = "/home/u/Downloads";
const USB = "/mnt/usb/Kaisu";
const DAY = 86_400_000;
const H = (id, title, preset, path, ageDays = 1, extra = {}) => ({ id, url: `https://www.youtube.com/watch?v=${id.padEnd(11, "0")}`, title, thumbnail: "", preset, path, timestamp: now - ageDays * DAY, ...extra });
const moveStore = { moveEnabled: true, moveDir: USB, warnDuplicates: false };
const wait = (page, ms) => page.waitForTimeout(ms);
const transfers = (page) => page.evaluate(() => window.__mock.transfers ?? []);
const deletes = (page) => page.evaluate(() => window.__mock.deleteCalls ?? []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ================= moving downloads to another drive =================
let page = await open({ store: { warnDuplicates: false } });
await nav(page, "Settings").click();
const group = () => page.locator("section[aria-label='Move downloads']");
check("move: off by default, with nothing else shown", await group().getByLabel("Move or copy").count() === 0);
await group().getByLabel("Move finished downloads to another folder").check();
check("move: asks for a folder first", await group().getByRole("status", { name: "Move destination check" }).locator("text=Choose a folder").count() === 1);
await group().getByRole("button", { name: "Choose…" }).click();
await group().getByRole("status", { name: "Move destination check" }).locator("text=/Ready\\. .* free there/").waitFor();
check("move: picking a folder checks it", (await settingsOf(page)).moveDir === "/home/u/Videos");
for (const label of ["Move or copy", "When to move", "Which downloads to move", "If a file is already there"]) check(`move: option "${label}"`, await group().getByLabel(label).count() === 1);
await page.context().close();

const HISTORY = [H("aaa", "Alpha video", "best", `${DL}/Alpha.mp4`), H("bbb", "Bravo song", "audio", `${DL}/Artist/Album/Bravo.mp3`), H("ccc", "Already elsewhere", "best", "/mnt/other/Charlie.mp4"), H("ddd", "No file", "best", null)];

page = await open({ history: HISTORY, store: moveStore });
await waitCalls(page, "transfer_files", 1, 20000);
let t = (await transfers(page))[0];
check("move: finished downloads go to the chosen folder", t.baseDir === DL && t.destDir === USB && t.mode === "move" && t.keepLayout === true && t.conflict === "keep_both", JSON.stringify(t));
check("move: only files in the download folder are sent", same(t.items.map((i) => i.path).sort(), [`${DL}/Alpha.mp4`, `${DL}/Artist/Album/Bravo.mp3`].sort()), JSON.stringify(t.items));
await wait(page, 600);
const h1 = await historyOf(page);
check("move: History follows the files", h1.find((h) => h.id === "bbb").path === `${USB}/Artist/Album/Bravo.mp3` && h1.find((h) => h.id === "aaa").path === `${USB}/Alpha.mp4` && h1.find((h) => h.id === "ccc").path === "/mnt/other/Charlie.mp4", JSON.stringify(h1.map((h) => h.path)));
check("move: says what happened", await page.locator("text=Moved 2 downloads").count() >= 0);
await wait(page, 2500);
check("move: moved files aren't sent again", (await transfers(page)).length === 1);
await page.context().close();

page = await open({ history: HISTORY, store: { ...moveStore, moveTypes: "audio" } });
await waitCalls(page, "transfer_files", 1, 20000);
check("move: can be limited to audio", same((await transfers(page))[0].items.map((i) => i.id), ["bbb"]));
await page.context().close();

page = await open({ history: HISTORY, store: { ...moveStore, moveTypes: "video" } });
await waitCalls(page, "transfer_files", 1, 20000);
check("move: …or to video", same((await transfers(page))[0].items.map((i) => i.id), ["aaa"]));
await page.context().close();

page = await open({ history: HISTORY, store: { ...moveStore, moveWhen: "manual", moveKeepLayout: false, moveConflict: "skip" } });
await wait(page, 3500);
check("move: 'only when I press' waits", (await transfers(page)).length === 0);
await nav(page, "Settings").click();
check("move: shows how many are waiting", await group().getByRole("status", { name: "Waiting to move" }).locator("text=2 downloads are waiting").count() === 1);
await group().getByRole("button", { name: "Move now" }).click();
await waitCalls(page, "transfer_files", 1);
t = (await transfers(page))[0];
check("move: Move now sends them, with the chosen options", t.keepLayout === false && t.conflict === "skip" && t.items.length === 2, JSON.stringify(t));
await page.context().close();

page = await open({ history: HISTORY, store: { ...moveStore, moveMode: "copy" } });
await waitCalls(page, "transfer_files", 1, 20000);
await wait(page, 700);
const h2 = await historyOf(page);
check("copy: originals stay where they are and are marked", h2.find((h) => h.id === "aaa").path === `${DL}/Alpha.mp4` && h2.find((h) => h.id === "aaa").transferred === `${USB}/Alpha.mp4`, JSON.stringify(h2.map((h) => [h.path, h.transferred])));
await wait(page, 2500);
check("copy: and aren't copied again", (await transfers(page)).length === 1);
await page.context().close();

page = await open({ history: HISTORY, store: moveStore, mock: { transferSkip: true } });
await waitCalls(page, "transfer_files", 1, 20000);
await wait(page, 700);
check("move: skipped files are marked so they aren't retried", (await historyOf(page)).find((h) => h.id === "aaa").transferred === "skipped");
await page.context().close();

// the drive isn't plugged in
page = await open({ history: HISTORY, store: moveStore, mock: { destMissing: true } });
await nav(page, "Settings").click();
await group().getByRole("alert", { name: "Move destination check" }).waitFor();
check("drive: a missing drive is explained", await group().getByRole("alert").locator("text=isn't connected").count() === 1 && await group().locator("text=carry on by itself").count() === 1);
check("drive: nothing is tried meanwhile", (await transfers(page)).length === 0);
check("drive: Move now is off", await group().getByRole("button", { name: "Move now" }).isDisabled());
await page.evaluate(() => (window.__mock.destMissing = false));
await waitCalls(page, "transfer_files", 1, 30000);
check("drive: plugging it in is noticed and the waiting files go", (await transfers(page)).length === 1);
await page.context().close();

page = await open({ history: HISTORY, store: moveStore, mock: { transferFail: [`${DL}/Alpha.mp4`] } });
await waitCalls(page, "transfer_files", 1, 20000);
await page.getByRole("status").filter({ hasText: "the drive is full" }).waitFor();
const h3 = await historyOf(page);
check("move: a failed file says why and stays put", h3.find((h) => h.id === "aaa").path === `${DL}/Alpha.mp4` && h3.find((h) => h.id === "bbb").path.startsWith(USB), JSON.stringify(h3.map((h) => h.path)));
await page.context().close();

// a download that finishes is moved without any help
page = await open({ store: moveStore });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "transfer_files", 1, 30000);
t = (await transfers(page))[0];
check("move: a new download is moved when it finishes", t.items.length === 1 && t.items[0].path.startsWith(DL) && t.destDir === USB, JSON.stringify(t));
await page.context().close();

// ================= deleting old downloads =================
const OLD = [H("old", "Old video", "best", `${DL}/Old.mp4`, 40), H("new", "New video", "best", `${DL}/New.mp4`, 3), H("usb", "Old on the drive", "best", `${USB}/Usb.mp4`, 90), H("far", "Elsewhere", "best", "/mnt/other/Far.mp4", 90)];
page = await open({ history: OLD });
await nav(page, "Settings").click();
const clean = () => page.locator("section[aria-label='Clean up']");
check("clean up: off by default", await clean().getByLabel("Delete downloads older than").inputValue() === "0");
await clean().getByLabel("Delete downloads older than").selectOption("30");
await page.getByRole("alertdialog").waitFor();
check("clean up: turning it on asks first, plainly", await page.getByRole("alertdialog").locator("text=can't be undone").count() === 1);
await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
check("clean up: cancel keeps it off", (await settingsOf(page)).autoDeleteDays === 0 && await clean().getByLabel("Delete downloads older than").inputValue() === "0");
await clean().getByLabel("Delete downloads older than").selectOption("30");
await page.getByRole("alertdialog").getByRole("button", { name: "Turn on" }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).settings.autoDeleteDays === 30);
check("clean up: confirming turns it on", true);
await clean().getByRole("status", { name: "Old downloads" }).waitFor();
check("clean up: says how many are old", await clean().getByRole("status", { name: "Old downloads" }).locator("text=1 download is older than 30 days").count() === 1, await clean().getByRole("status", { name: "Old downloads" }).innerText());
await clean().getByRole("button", { name: "Clean up now" }).click();
await waitCalls(page, "delete_files", 1);
let d = (await deletes(page))[0];
check("clean up: only the old file in the download folder is deleted", same(d.paths, [`${DL}/Old.mp4`]) && same(d.allowed, [DL]), JSON.stringify(d));
await page.context().close();

page = await open({ history: OLD, store: { autoDeleteDays: 30 } });
await waitCalls(page, "delete_files", 1, 30000);
check("clean up: runs by itself after start-up", same((await deletes(page))[0].paths, [`${DL}/Old.mp4`]));
await page.context().close();

page = await open({ history: OLD, store: { autoDeleteDays: 30, autoDeleteMoved: true, moveEnabled: true, moveDir: USB, moveWhen: "manual" } });
await waitCalls(page, "delete_files", 1, 30000);
d = (await deletes(page))[0];
check("clean up: can include the drive's folder", same(d.paths.slice().sort(), [`${DL}/Old.mp4`, `${USB}/Usb.mp4`].sort()) && same(d.allowed, [DL, USB]), JSON.stringify(d));
await page.context().close();

page = await open({ history: OLD, store: { autoDeleteDays: 0 } });
await wait(page, 10500);
check("clean up: never deletes when it's off", (await deletes(page)).length === 0);
await page.context().close();

page = await open({ history: OLD, store: { autoDeleteDays: 30 }, mock: { deleteFail: true } });
await waitCalls(page, "delete_files", 1, 30000);
check("clean up: a failure doesn't pop up on its own", await page.getByRole("status").filter({ hasText: "permission denied" }).count() === 0);
await page.context().close();

// ================= quick actions =================
page = await open({ history: [H("q1", "Quick video", "best", `${DL}/Quick.mp4`)] });
await nav(page, "History").click();
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
const row = () => page.locator("tr", { hasText: "Quick video" }).first();
await row().getByRole("button", { name: "Copy file location" }).click();
await page.getByRole("status").filter({ hasText: "File location copied" }).waitFor();
check("quick: copy the file's location", (await page.evaluate(() => navigator.clipboard.readText())) === `${DL}/Quick.mp4`);
await row().getByRole("button", { name: "Delete file" }).click();
await page.getByRole("alertdialog").waitFor();
check("quick: deleting asks first", await page.getByRole("alertdialog").locator("text=can't be undone").count() === 1);
await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
check("quick: cancel deletes nothing", (await deletes(page)).length === 0 && (await historyOf(page)).length === 1);
await row().getByRole("button", { name: "Delete file" }).click();
await page.getByRole("alertdialog").getByRole("button", { name: "Delete file" }).click();
await waitCalls(page, "delete_files", 1);
d = (await deletes(page))[0];
check("quick: deleting removes the file and its history entry", same(d.paths, [`${DL}/Quick.mp4`]) && d.allowed.includes(DL) && (await historyOf(page)).length === 0, JSON.stringify(d));
await page.context().close();

page = await open({ history: [H("q2", "Older", "best", `${DL}/Older.mp4`, 5), H("q3", "Latest", "best", `${DL}/Latest.mp4`, 1)] });
await page.keyboard.press("Control+Shift+L");
await waitCalls(page, "open_file", 1);
check("quick: Ctrl+Shift+L plays the latest download", (await calls(page, "open_file")).at(-1).args.path === `${DL}/Latest.mp4`);
await page.context().close();

page = await open({ store: { warnDuplicates: false } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await nav(page, "Downloads").click();
await page.waitForSelector(".progress.done", { timeout: 20000 });
check("quick: finished downloads offer the same actions", await page.getByRole("button", { name: "Copy file location" }).count() === 1 && await page.getByRole("button", { name: "Delete file" }).count() === 1);
await page.context().close();

// ================= smart naming =================
page = await open({ store: { warnDuplicates: false } });
await nav(page, "Settings").click();
const layouts = await page.getByLabel("Folder layout").locator("option").allTextContents();
check("naming: a music layout is offered", layouts.includes("Artist / Album folders (for music)"), JSON.stringify(layouts));
await page.getByLabel("Folder layout").selectOption("music");
await page.getByLabel("File names").selectOption("track_title");
check("naming: the example shows the result", await page.locator("text=Daft Punk/Discovery/7 - One More Time.mp4").count() >= 1 || await page.locator("text=Daft Punk/Discovery/7 - One More Time.mp3").count() >= 1);
check("naming: choices are saved", (await settingsOf(page)).layout === "music" && (await settingsOf(page)).nameStyle === "track_title");
await page.getByLabel(/Tidy titles/).check();
check("naming: tidy titles is saved", (await settingsOf(page)).cleanTitles === true);
await nav(page, "Search").click();
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
const req = (await calls(page, "start_download")).at(-1).args.req;
check("naming: the request carries layout, style and tidy titles", req.extra.output.layout === "music" && req.extra.output.name === "track_title" && req.extra.clean_titles === true, JSON.stringify([req.extra.output, req.extra.clean_titles]));
await page.context().close();

// ================= first run =================
async function openSetup(mock = {}, settings = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1060, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript(([m, st]) => {
    window.__mock = { ready: false, calls: [], dlDelay: 80, missing: [], setupDelay: 50, notifications: [], ...m };
    if (!localStorage.getItem("__store")) localStorage.setItem("__store", JSON.stringify({ settings: { mode: "simple", tourSeen: true, ...st }, history: [], queue: [] }));
  }, [mock, settings]);
  await p.goto(BASE_URL);
  await p.waitForSelector("text=Let's get Kaisu ready");
  return p;
}
page = await openSetup();
const setup = () => page.getByRole("dialog", { name: "Set up Kaisu" });
check("first run: each part says how big it is", await setup().locator("text=(about 35 MB)").count() === 1 && await setup().locator("text=(about 100 MB)").count() === 1 && await setup().locator("text=(about 40 MB)").count() === 1);
check("first run: no space warning when there's room", await setup().getByRole("alert").count() === 0);
await setup().locator("summary", { hasText: "Behind a proxy or firewall?" }).click();
await setup().getByLabel("Setup proxy").fill("ftp://nope");
check("first run: a bad proxy is flagged", await setup().getByRole("alert").locator("text=aren't supported").count() === 1);
await setup().getByRole("button", { name: "Set up automatically" }).click();
await wait(page, 400);
check("first run: …and setup doesn't start with it", (await calls(page, "run_setup")).length === 0);
await setup().getByLabel("Setup proxy").fill("socks5://127.0.0.1:1080");
await setup().getByRole("button", { name: "Set up automatically" }).click();
await waitCalls(page, "run_setup", 1);
check("first run: setup goes through the proxy", (await calls(page, "run_setup"))[0].args.proxy === "socks5://127.0.0.1:1080", JSON.stringify((await calls(page, "run_setup"))[0].args));
await page.waitForSelector(".toolbar", { timeout: 20000 });
check("first run: the proxy is kept in Settings afterwards", (await settingsOf(page)).proxy === "socks5://127.0.0.1:1080");
await page.context().close();

page = await openSetup({ freeBytes: 100 * 1024 * 1024 });
check("first run: low disk space is called out", await setup().getByRole("alert").locator("text=Only 100 MB is free").count() === 1, await setup().innerText());
await page.context().close();

page = await openSetup();
await setup().locator("summary", { hasText: "Prefer to install them yourself?" }).click();
const before = (await calls(page, "check_setup")).length;
await setup().getByRole("button", { name: "I've installed them, check again" }).click();
await page.waitForFunction((n) => window.__mock.calls.filter((c) => c.cmd === "check_setup").length > n, before);
check("first run: 'check again' looks at the computer again", await setup().getByRole("status").locator("text=Looked again").count() === 1);
await page.evaluate(() => (window.__mock.ready = true));
await setup().getByRole("button", { name: "I've installed them, check again" }).click();
await page.waitForSelector(".toolbar", { timeout: 8000 });
check("first run: …and the screen closes once the tools are found", true);
await page.context().close();

await done();
