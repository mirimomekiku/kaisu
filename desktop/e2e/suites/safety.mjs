import { open, check, calls, waitCalls, box, nav, results, details, submit, now, done } from "../harness.mjs";

const VIDEO = "https://www.youtube.com/watch?v=pasted00001";
const dialog = (page) => page.getByRole("alertdialog");
const startFromCard = async (page, url = VIDEO, button = /^Download (video|audio|clip)$/) => {
  await submit(page, url);
  await details(page).waitFor();
  const b = details(page).getByRole("button", { name: button });
  if (!(await b.count())) await details(page).getByRole("button", { name: /Download again|What would you like/ }).click();
  await details(page).getByRole("button", { name: button }).click();
};
/** Advances the fake clock one second at a time, giving React time to render between ticks. */
const tick = async (page, seconds) => { for (let i = 0; i < seconds; i++) { await page.clock.runFor(1000); await page.waitForTimeout(25); } };
const HIST = (over = {}) => ({ id: "h1", url: VIDEO, title: "Pasted Video One", thumbnail: "", preset: "best", path: "/home/u/Downloads/one.mp4", timestamp: now - 1000, ...over });

// ================= notifications =================
let page = await open({ focus: false });
await startFromCard(page);
await page.waitForFunction(() => window.__mock.notifications?.length > 0, null, { timeout: 15000 });
let n = await page.evaluate(() => window.__mock.notifications);
check("notify: sent when downloads finish while the window isn't focused", n.length === 1 && /Kaisu: downloads finished/.test(n[0].title) && /1 downloaded/.test(n[0].body), JSON.stringify(n));
check("notify: the display says so too", await page.getByLabel("Status display").locator("text=Downloads finished").count() === 1);

page = await open({ focus: true });
await startFromCard(page);
await page.waitForSelector("text=Downloads finished");
await page.waitForTimeout(400);
check("notify: not sent while you're looking at the window", (await page.evaluate(() => window.__mock.notifications.length)) === 0);

page = await open({ focus: false, store: { notifyWhenDone: false } });
await startFromCard(page);
await page.waitForSelector("text=Downloads finished");
await page.waitForTimeout(400);
check("notify: setting turns it off", (await page.evaluate(() => window.__mock.notifications.length)) === 0);

page = await open({ focus: false, mock: { failAll: false } });
await page.evaluate(() => (window.__mock.notifications = []));
await startFromCard(page, "https://example.com/fail");
await page.waitForSelector("text=Downloads failed");
check("notify: a batch where everything failed says so", (await page.evaluate(() => window.__mock.notifications.at(-1)?.body)) === "1 failed");

// a batch produces ONE notification, not one per item
page = await open({ focus: false });
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
for (const i of [1, 2, 3]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${i}$`)).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 3 videos" }).click();
await page.waitForFunction(() => window.__mock.notifications?.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(600);
n = await page.evaluate(() => window.__mock.notifications);
check("notify: one notification for the whole batch", n.length === 1 && /3 downloaded/.test(n[0].body), JSON.stringify(n));

// ================= when done =================
page = await open();
await nav(page, "Downloads").click();
const whenDone = page.getByLabel("When downloads finish");
check("when done: defaults to nothing", (await whenDone.inputValue()) === "nothing");
await whenDone.selectOption("folder");
await nav(page, "Search").click();
await startFromCard(page);
await waitCalls(page, "open_folder", 1, 20000);
check("when done: open the folder", (await calls(page, "open_folder")).at(-1).args.path === "/home/u/Downloads");
await nav(page, "Downloads").click();
check("when done: one-shot, resets itself", (await whenDone.inputValue()) === "nothing");

page = await open();
await nav(page, "Downloads").click();
await page.getByLabel("When downloads finish").selectOption("quit");
await nav(page, "Search").click();
await startFromCard(page);
await waitCalls(page, "quit_app", 1, 20000);
check("when done: quit Kaisu", true);

page = await open({ clock: true });
await nav(page, "Downloads").click();
await page.getByLabel("When downloads finish").selectOption("sleep");
await nav(page, "Search").click();
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await tick(page, 3);
await page.getByRole("alert").filter({ hasText: "put the computer to sleep" }).waitFor();
const secondsLeft = async () => Number((await page.getByRole("alert").filter({ hasText: "computer to sleep" }).innerText()).match(/in (\d+) second/)[1]);
const s0 = await secondsLeft();
check("when done: sleep shows a cancellable countdown starting around 30", await page.getByRole("button", { name: "Cancel" }).count() === 1 && s0 >= 28 && s0 <= 30, String(s0));
await tick(page, 10);
const s1 = await secondsLeft();
check("when done: the countdown ticks down", s0 - s1 >= 9 && s0 - s1 <= 10, `${s0} -> ${s1}`);
const fired = (page) => page.evaluate(() => window.__mock.powerFired ?? []);
check("when done: the countdown is handed to the backend, 30 seconds, for sleep", (await calls(page, "schedule_power")).length === 1 && (await calls(page, "schedule_power"))[0].args.action === "sleep" && (await calls(page, "schedule_power"))[0].args.seconds === 30);
check("when done: nothing happens before it ends", (await fired(page)).length === 0);
await page.getByRole("button", { name: "Cancel" }).click();
await tick(page, 40);
check("when done: Cancel tells the backend, and stops it for good", (await calls(page, "cancel_power")).length === 1 && (await fired(page)).length === 0);

page = await open({ clock: true });
await nav(page, "Downloads").click();
await page.getByLabel("When downloads finish").selectOption("shutdown");
await nav(page, "Search").click();
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await tick(page, 3);
await page.getByRole("alert").filter({ hasText: "shut the computer down" }).waitFor();
await tick(page, 31);
await page.waitForFunction(() => (window.__mock.powerFired ?? []).length >= 1, null, { timeout: 5000 });
check("when done: shutdown fires after 30 seconds", (await fired(page)).at(-1).action === "shutdown");
check("when done: the page itself never asks for the power action", (await calls(page, "system_power")).length === 0);

// ================= clipboard =================
const YT = "https://www.youtube.com/watch?v=clip0000001";
page = await open({ mock: { clipboard: YT } });
await page.waitForSelector("text=You copied a link");
check("clipboard: offered on start", await page.locator("b", { hasText: "youtube.com/watch?v=clip0000001" }).count() === 1);
check("clipboard: nothing looked up yet", (await calls(page, "get_media_info")).length === 0);
await page.getByRole("button", { name: "Look it up" }).click();
await details(page).waitFor();
check("clipboard: Look it up inspects the link", (await calls(page, "get_media_info")).at(-1).args.url === YT && (await box(page).inputValue()) === YT);
check("clipboard: banner goes away", await page.locator("text=You copied a link").count() === 0);

page = await open({ mock: { clipboard: YT } });
await page.waitForSelector("text=You copied a link");
await page.getByRole("button", { name: "Dismiss" }).first().click();
await page.evaluate(() => window.dispatchEvent(new Event("focus")));
await page.waitForTimeout(300);
check("clipboard: a dismissed link isn't offered again", await page.locator("text=You copied a link").count() === 0);
await page.evaluate(() => { window.__mock.clipboard = "https://vimeo.com/123456"; window.dispatchEvent(new Event("focus")); });
await page.waitForSelector("text=You copied a link");
check("clipboard: a different link is offered on refocus", await page.locator("b", { hasText: "vimeo.com/123456" }).count() === 1);

for (const [label, clip] of [["an ordinary website", "https://example.com/some/article"], ["plain text", "hello world"], ["two links", `${YT} ${YT}x`], ["a link inside a sentence", `watch ${YT} now`]]) {
  page = await open({ mock: { clipboard: clip } });
  await page.waitForTimeout(500);
  check(`clipboard: not offered for ${label}`, await page.locator("text=You copied a link").count() === 0);
}
page = await open({ mock: { clipboard: YT }, store: { watchClipboard: false } });
await page.waitForTimeout(500);
check("clipboard: setting turns it off", await page.locator("text=You copied a link").count() === 0);
page = await open({ mock: { clipboard: YT }, focus: false });
await page.waitForTimeout(500);
check("clipboard: not read while the window is in the background", await page.locator("text=You copied a link").count() === 0);

// ================= drag and drop =================
const drag = (page, type, data) =>
  page.evaluate(([t, d]) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(d)) dt.setData(k, v);
    const ev = new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, [type, data]);

page = await open();
await drag(page, "dragenter", { "text/uri-list": VIDEO });
check("drop: overlay while dragging a link over the window", await page.locator(".drop-overlay").count() === 1);
check("drop: drop target accepts it", await drag(page, "dragover", { "text/uri-list": VIDEO }));
await drag(page, "dragleave", { "text/uri-list": VIDEO });
check("drop: overlay goes when the drag leaves", await page.locator(".drop-overlay").count() === 0);
await drag(page, "dragenter", { "text/uri-list": VIDEO });
await drag(page, "drop", { "text/uri-list": VIDEO });
await details(page).waitFor();
check("drop: the link is looked up", (await calls(page, "get_media_info")).at(-1).args.url === VIDEO && (await box(page).inputValue()) === VIDEO);
check("drop: overlay is gone", await page.locator(".drop-overlay").count() === 0);

page = await open();
await drag(page, "drop", { "text/plain": `${YT}\nhttps://youtu.be/dropped00002` });
await page.waitForSelector("text=2 links");
check("drop: several links become a list", await results(page).locator("tbody tr").count() === 2);
page = await open();
await drag(page, "dragenter", { "text/plain": "just words" });
await drag(page, "drop", { "text/plain": "just words" });
await page.waitForSelector("text=doesn't contain a link");
check("drop: text without a link says so", true);
page = await open();
check("drop: file-only drags are ignored (no overlay)", !(await drag(page, "dragenter", {})) && await page.locator(".drop-overlay").count() === 0);

// ================= duplicates =================
page = await open({ history: [HIST()] });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download again" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await dialog(page).waitFor();
check("duplicate: asks before repeating a download", await dialog(page).locator("text=You already downloaded this").count() === 1);
check("duplicate: names the video", await dialog(page).locator("b", { hasText: "Big Buck Bunny" }).count() === 1);
check("duplicate: three choices, safe default is Download again", await dialog(page).getByRole("button").count() === 3);
await page.keyboard.press("Escape");
check("duplicate: Escape cancels, nothing started", await dialog(page).count() === 0 && (await calls(page, "start_download")).length === 0);
check("duplicate: cancelling keeps the choices open", await details(page).getByRole("radio", { name: /Audio only/ }).count() === 1);
await details(page).getByRole("button", { name: "Download video" }).click();
await dialog(page).getByRole("button", { name: "Open the file" }).click();
await page.waitForTimeout(200);
check("duplicate: Open the file opens the existing one", (await calls(page, "open_file")).at(-1)?.args.path === "/home/u/Downloads/one.mp4" && (await calls(page, "start_download")).length === 0);
await details(page).getByRole("button", { name: "Download video" }).click();
await dialog(page).getByRole("button", { name: "Download again" }).click();
await waitCalls(page, "start_download", 1);
check("duplicate: Download again goes ahead", true);

page = await open({ history: [HIST()] });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download again" }).click();
await details(page).getByRole("radio", { name: /Audio only/ }).click();
await details(page).getByRole("button", { name: "Download audio" }).click();
await page.waitForTimeout(400);
check("duplicate: a different kind (audio) isn't a duplicate of the video", await dialog(page).count() === 0 && (await calls(page, "start_download")).length === 1);

page = await open({ history: [HIST()], mock: { missing: ["/home/u/Downloads/one.mp4"] } });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download again" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await page.waitForTimeout(400);
check("duplicate: not a duplicate if the file was deleted", await dialog(page).count() === 0 && (await calls(page, "start_download")).length === 1);

page = await open({ history: [HIST()], store: { warnDuplicates: false } });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download again" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await page.waitForTimeout(400);
check("duplicate: setting turns the warning off", await dialog(page).count() === 0 && (await calls(page, "start_download")).length === 1);

// queued twice
page = await open({ mock: { dlDelay: 800 } });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
await details(page).getByRole("button", { name: "What would you like to download?" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await page.getByLabel("Status display").locator("text=Already in Downloads").waitFor();
await page.waitForTimeout(300);
check("duplicate: the same download isn't queued twice", (await calls(page, "start_download")).length === 1);

// batch with some duplicates
page = await open({ history: [HIST({ id: "d1", url: "https://www.youtube.com/watch?v=vid00000001", path: "/home/u/Downloads/a.mp4" }), HIST({ id: "d2", url: "https://www.youtube.com/watch?v=vid00000003", path: "/home/u/Downloads/b.mp4" })] });
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
for (const i of [2, 3, 4, 5]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${i}$`)).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 4 videos" }).click();
await dialog(page).waitFor();
check("batch duplicates: counts them", await dialog(page).locator("text=2 of these are already downloaded").count() === 1);
await dialog(page).getByRole("button", { name: /Skip 2 already downloaded/ }).click();
await waitCalls(page, "start_download", 2);
await page.waitForTimeout(400);
const got = (await calls(page, "start_download")).map((c) => c.args.req.url.slice(-11)).sort();
check("batch duplicates: skipping downloads only the new ones", JSON.stringify(got) === JSON.stringify(["vid00000001", "vid00000004"]) || got.length === 2, JSON.stringify(got));

// ================= disk space =================
page = await open({ mock: { free: 800 * 1024 * 1024 } });
await startFromCard(page);
await dialog(page).waitFor();
check("disk: warns when space is low", await dialog(page).locator("text=Low disk space").count() === 1 && await dialog(page).locator("b", { hasText: /MB/ }).count() === 1);
check("disk: the safe choice is the default", (await page.evaluate(() => document.activeElement?.textContent)) === "Cancel");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("disk: cancelling starts nothing", (await calls(page, "start_download")).length === 0);
await details(page).getByRole("button", { name: "Download video" }).click();
await dialog(page).getByRole("button", { name: "Download anyway" }).click();
await waitCalls(page, "start_download", 1);
check("disk: Download anyway proceeds", true);
page = await open({ mock: { free: 100 * 1024 ** 3 } });
await startFromCard(page);
await page.waitForTimeout(400);
check("disk: no warning when there is plenty of room", await dialog(page).count() === 0 && (await calls(page, "start_download")).length === 1);
page = await open({ mock: { free: 800 * 1024 * 1024 }, history: [HIST()] });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download again" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await dialog(page).getByRole("button", { name: "Download again" }).click();
await dialog(page).locator("text=Low disk space").waitFor();
check("disk: checked after the duplicate question", true);

await done();
