import { open, check, calls, waitCalls, box, nav, results, details, submit, now, done } from "../harness.mjs";

const VIDEO = "https://www.youtube.com/watch?v=pasted00001";
const dialog = (page) => page.getByRole("alertdialog");
const card = async (page, url = VIDEO) => { await submit(page, url); await details(page).waitFor(); };
const lastReq = async (page) => (await calls(page, "start_download")).at(-1).args.req;

// ================= clips =================
let page = await open();
await card(page);
const clipBtn = () => details(page).getByRole("button", { name: "Download only part of this video" });
check("clip: offered, but tucked away", (await clipBtn().getAttribute("aria-expanded")) === "false" && await details(page).getByLabel("Clip start").count() === 0);
await clipBtn().click();
check("clip: start defaults to 0:00 and end to the full length", (await details(page).getByLabel("Clip start").inputValue()) === "0:00" && (await details(page).getByLabel("Clip end").inputValue()) === "10:35");
check("clip: shows the video length", await details(page).locator("text=(video is 10:35 long)").count() === 1);
check("clip: valid default → 'Download clip' button", await details(page).getByRole("button", { name: "Download clip" }).count() === 1);
await details(page).getByLabel("Clip start").fill("abc");
check("clip: junk is rejected with a hint", await details(page).getByRole("alert").locator("text=Type times like 1:20").count() === 1 && await details(page).getByRole("button", { name: "Download clip" }).isDisabled());
await details(page).getByLabel("Clip start").fill("2:00");
await details(page).getByLabel("Clip end").fill("1:00");
check("clip: end must be after start", await details(page).getByRole("alert").locator("text=The end must come after the start.").count() === 1);
await details(page).getByLabel("Clip end").fill("99:00");
check("clip: can't run past the video", await details(page).getByRole("alert").locator("text=The video is only 10:35 long.").count() === 1);
await details(page).getByLabel("Clip start").fill("1:60");
check("clip: seconds must be under 60", await details(page).getByRole("alert").count() === 1);
await details(page).getByLabel("Clip start").fill("1:20");
await details(page).getByLabel("Clip end").fill("2:45");
check("clip: summary of what will be downloaded", await details(page).locator("text=Downloads 1:25 from 1:20 to 2:45.").count() === 1);
await details(page).getByLabel(/Cut exactly at these times/).check();
await details(page).getByRole("button", { name: "Download clip" }).click();
await waitCalls(page, "start_download", 1);
let req = await lastReq(page);
check("clip: request carries the section", req.extra.clip && req.extra.clip.start === 80 && req.extra.clip.end === 165 && req.extra.clip.precise === true, JSON.stringify(req.extra.clip));
await nav(page, "Downloads").click();
await page.waitForSelector(".progress.done", { timeout: 15000 });
check("clip: queue title says it's a clip", await page.locator("td", { hasText: "(clip 1:20 to 2:45)" }).count() === 1);
const hist = await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).history);
check("clip: history remembers the section", hist.length === 1 && hist[0].clip === "80-165", JSON.stringify(hist));
await nav(page, "Search").click();
await page.waitForTimeout(200);
check("clip: the card lists it as a clip", await details(page).locator("text=(clip 1:20 to 2:45)").count() === 1);
// a clip isn't a duplicate of the whole video, and vice versa
await details(page).getByRole("button", { name: "Download again" }).click();
await clipBtn().click();
await details(page).getByLabel("Clip start").fill("0:10");
await details(page).getByLabel("Clip end").fill("0:20");
await details(page).getByRole("button", { name: "Download clip" }).click();
await waitCalls(page, "start_download", 2);
check("clip: a different section is not a duplicate", await dialog(page).count() === 0);
await page.waitForTimeout(2500);
await details(page).getByRole("button", { name: "Download again" }).click();
await details(page).getByLabel("Clip start").fill("1:20");
await details(page).getByLabel("Clip end").fill("2:45");
await details(page).getByRole("button", { name: "Download clip" }).click();
await dialog(page).waitFor();
check("clip: the same section again IS a duplicate", await dialog(page).locator("text=You already downloaded this").count() === 1);
await page.keyboard.press("Escape");
await details(page).getByRole("button", { name: "Download only part of this video" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 3);
check("clip: the whole video isn't a duplicate of a clip", await dialog(page).count() === 0 && (await lastReq(page)).extra.clip === null);

// clip as audio
page = await open();
await card(page);
await clipBtn().click();
await details(page).getByRole("radio", { name: /Audio only/ }).click();
await details(page).getByLabel("Clip start").fill("0:30");
await details(page).getByLabel("Clip end").fill("1:00");
await details(page).getByRole("button", { name: "Download clip" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("clip: works for audio too", req.preset === "audio" && req.extra.clip.start === 30 && req.extra.clip.precise === false);
// collapsing the section means no clip
page = await open();
await card(page);
await clipBtn().click();
await details(page).getByLabel("Clip start").fill("0:30");
await clipBtn().click();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("clip: closing the section downloads the whole video", (await lastReq(page)).extra.clip === null);
// live streams can't be clipped
page = await open({ mock: { live: true } });
await card(page);
check("clip: not offered for live streams", await clipBtn().count() === 0);

// ================= output organisation =================
page = await open();
await nav(page, "Settings").click();
const ex = () => page.getByLabel("Example path").innerText();
const exPl = () => page.getByLabel("Example playlist path").innerText();
check("output: default example", (await ex()) === "Big Buck Bunny [aqz-KE-bpKQ].mp4", await ex());
check("output: playlist example has a numbered folder", (await exPl()) === "Road Trip Mix/04 - Big Buck Bunny [aqz-KE-bpKQ].mp4", await exPl());
await page.getByLabel("Folder layout").selectOption("channel");
check("output: by channel", (await ex()) === "Blender/Big Buck Bunny [aqz-KE-bpKQ].mp4", await ex());
await page.getByLabel("Folder layout").selectOption("kind");
check("output: video/audio folders", (await ex()) === "Video/Big Buck Bunny [aqz-KE-bpKQ].mp4");
await page.getByLabel("Folder layout").selectOption("year");
check("output: by year", (await ex()) === "2014/Big Buck Bunny [aqz-KE-bpKQ].mp4");
await page.getByLabel("File names").selectOption("channel_title");
check("output: Channel - Title", (await ex()) === "2014/Blender - Big Buck Bunny.mp4", await ex());
await page.getByLabel("File names").selectOption("date_title");
check("output: Date - Title", (await ex()) === "2014/2014-05-30 - Big Buck Bunny.mp4", await ex());
await page.getByLabel("File names").selectOption("title");
check("output: Title only", (await ex()) === "2014/Big Buck Bunny.mp4");
await page.getByLabel(/Put playlist downloads in a folder/).uncheck();
await page.getByLabel(/Number playlist items/).uncheck();
check("output: playlist options update the example", (await exPl()) === "2014/Big Buck Bunny.mp4", await exPl());
check("output: simple mode hides the custom template", await page.getByLabel("Custom file name template").count() === 0);
// the preferences reach the download request, in Simple mode too
await page.getByLabel("Folder layout").selectOption("channel");
await nav(page, "Search").click();
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("output: request carries the chosen layout and name", req.extra.output.layout === "channel" && req.extra.output.name === "title" && req.extra.output.playlist_folder === false && req.extra.output.playlist_numbering === false && req.extra.output.custom === null, JSON.stringify(req.extra.output));

// custom template (Advanced)
page = await open({ store: { mode: "advanced" } });
await nav(page, "Settings").click();
const custom = page.getByLabel("Custom file name template");
await custom.fill("../escape/%(title)s");
check("output: custom template with '..' is flagged immediately", await page.getByRole("alert").locator("text=can't be empty, '.' or '..'").count() === 1);
for (const [bad, hint] of [["/etc/%(title)s", "relative"], ["a\\b", "Use /"], ['bad:name', "can't contain"]]) {
  await custom.fill(bad);
  check(`output: rejects ${JSON.stringify(bad)}`, await page.getByRole("alert").locator(`text=${hint}`).count() === 1);
}
await custom.fill("%(channel)s/%(title)s");
check("output: a good template has no error", await page.getByRole("alert").count() === 0);
check("output: example follows the template", (await ex()) === "Blender/Big Buck Bunny.mp4", await ex());
check("output: the file-name style is disabled while a template is set", await page.getByLabel("File names").isDisabled());
await nav(page, "Search").click();
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("output: request carries the template", (await lastReq(page)).extra.output.custom === "%(channel)s/%(title)s");
// switching to Simple ignores it
await nav(page, "Settings").click();
await page.getByRole("radio", { name: /^simple/i }).click();
await nav(page, "Search").click();
await card(page, "https://www.youtube.com/watch?v=second000001");
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 2);
check("output: Simple mode ignores the custom template", (await lastReq(page)).extra.output.custom === null);

// ================= keyboard shortcuts =================
const current = (page) => page.getByRole("navigation", { name: "Sections" }).locator("[aria-current=page]").innerText();
page = await open();
await page.keyboard.press("F1");
await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
const sections = await page.getByRole("dialog", { name: "Keyboard shortcuts" }).locator("section").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("shortcuts: F1 opens the cheat sheet with its groups", JSON.stringify(sections) === JSON.stringify(["Search", "Downloading", "Go to"]));
check("shortcuts: shows Ctrl (or the Mac key) not 'Mod'", (await page.getByRole("dialog").innerText()).includes("Ctrl") && !(await page.getByRole("dialog").innerText()).includes("Mod"));
await page.keyboard.press("Control+2");
check("shortcuts: ignored while a dialog is open", (await current(page)).startsWith("Search"));
await page.keyboard.press("Escape");
check("shortcuts: Escape closes the cheat sheet", await page.getByRole("dialog", { name: "Keyboard shortcuts" }).count() === 0);
await page.keyboard.press("Control+/");
check("shortcuts: Ctrl+/ also opens it", await page.getByRole("dialog", { name: "Keyboard shortcuts" }).count() === 1);
await page.keyboard.press("Escape");

for (const [key, name] of [["2", "Downloads"], ["3", "History"], ["4", "Settings"], ["1", "Search"]]) {
  await page.keyboard.press(`Control+${key}`);
  check(`shortcuts: Ctrl+${key} → ${name}`, (await current(page)).startsWith(name));
}
await page.keyboard.press("Control+,");
check("shortcuts: Ctrl+, → Settings", (await current(page)).startsWith("Settings"));
await page.getByRole("button", { name: "Show shortcuts" }).click();
check("shortcuts: Settings has a button for the cheat sheet", await page.getByRole("dialog", { name: "Keyboard shortcuts" }).count() === 1);
await page.keyboard.press("Escape");

await box(page).fill("typed text");
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+f");
check("shortcuts: Ctrl+F focuses the search box", await box(page).evaluate((e) => document.activeElement === e));
check("shortcuts: ...and selects what is there", await box(page).evaluate((e) => e.selectionStart === 0 && e.selectionEnd === e.value.length));
await page.keyboard.press("Control+3");
await page.keyboard.press("Control+k");
check("shortcuts: Ctrl+K jumps to Search and focuses it", (await current(page)).startsWith("Search") && await box(page).evaluate((e) => document.activeElement === e));
await page.keyboard.press("Control+4");
await page.keyboard.press("Control+l");
check("shortcuts: Ctrl+L too", (await current(page)).startsWith("Search"));

// select all / escape
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
await page.keyboard.press("Control+a");
check("shortcuts: Ctrl+A inside the search box selects its text, not the results", await page.getByRole("region", { name: "Selected videos" }).count() === 0);
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+a");
check("shortcuts: Ctrl+A selects every result", await page.getByRole("region", { name: "Selected videos" }).locator("text=12 selected").count() === 1);
await page.keyboard.press("Escape");
check("shortcuts: Escape clears the selection", await page.getByRole("region", { name: "Selected videos" }).count() === 0);
await box(page).focus();
await page.keyboard.press("Escape");
check("shortcuts: Escape leaves the search box", await box(page).evaluate((e) => document.activeElement !== e));

// download shortcuts
await submit(page, VIDEO);
await details(page).waitFor();
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+d");
await waitCalls(page, "start_download", 1);
check("shortcuts: Ctrl+D downloads the open video", (await lastReq(page)).preset === "best" && (await lastReq(page)).url === VIDEO);
await page.keyboard.press("Control+Shift+D");
await page.waitForTimeout(500);
await page.getByLabel("Status display").locator("text=/Added|Already|duplicate/").first().waitFor({ timeout: 3000 }).catch(() => {});
await dialog(page).waitFor({ timeout: 3000 }).catch(() => {});
const audioReq = (await calls(page, "start_download")).find((c) => c.args.req.preset === "audio");
check("shortcuts: Ctrl+Shift+D downloads audio", !!audioReq);

page = await open({ mock: { dlDelay: 600 } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+Shift+P");
await nav(page, "Downloads").click();
await page.getByRole("button", { name: "Resume download" }).waitFor({ timeout: 6000 });
check("shortcuts: Ctrl+Shift+P pauses everything", true);
await page.keyboard.press("Control+Shift+P");
await page.getByRole("button", { name: "Pause download" }).waitFor({ timeout: 6000 });
check("shortcuts: ...and resumes it", true);
await page.keyboard.press("Control+o");
await waitCalls(page, "open_folder", 1, 3000);
check("shortcuts: Ctrl+O opens the download folder", (await calls(page, "open_folder")).at(-1).args.path === "/home/u/Downloads");

// ================= tray and background =================
page = await open();
await page.waitForFunction(() => window.__mock.calls.some((c) => c.cmd === "set_tray_status"));
let tray = (await calls(page, "set_tray_status")).at(-1).args;
check("tray: reports an idle queue and the close behaviour on start", tray.active === 0 && tray.queued === 0 && tray.paused === 0 && tray.mode === "downloads", JSON.stringify(tray));
await nav(page, "Settings").click();
await page.getByLabel("When I close the window").selectOption("always");
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "set_tray_status").at(-1).args.mode === "always");
check("tray: changing the close behaviour is reported", true);
await page.getByLabel("When I close the window").selectOption("never");
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "set_tray_status").at(-1).args.mode === "never");
check("tray: and 'quit' too", true);

page = await open({ mock: { dlDelay: 600 } });
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
for (const i of [1, 2, 3]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${i}$`)).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 3 videos" }).click();
await page.waitForFunction(() => window.__mock.calls.some((c) => c.cmd === "set_tray_status" && c.args.active === 2 && c.args.queued === 1), null, { timeout: 8000 });
check("tray: reports 2 downloading and 1 waiting", true);
await page.evaluate(() => window.__events["background-started"]({ payload: null }));
await page.waitForFunction(() => window.__mock.notifications?.length > 0);
check("tray: going to the background tells you downloads continue", /still downloading/.test(await page.evaluate(() => window.__mock.notifications.at(-1).title)));

page = await open({ mock: { tray: false } });
await nav(page, "Settings").click();
await page.getByLabel("When I close the window").waitFor();
check("tray: no tray support → control disabled with an explanation", await page.getByLabel("When I close the window").isDisabled() && await page.locator("text=doesn't show tray icons").count() === 1);

await done();
