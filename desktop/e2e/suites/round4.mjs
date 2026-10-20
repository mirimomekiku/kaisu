import { open, check, calls, waitCalls, nav, results, details, submit, now, done } from "../harness.mjs";

const VIDEO = "https://www.youtube.com/watch?v=pasted00001";
const anyBox = (page) => page.getByLabel(/^Search .* or paste a link$/);
const lastReq = async (page) => (await calls(page, "start_download")).at(-1).args.req;
const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings);
const card = async (page, url = VIDEO) => { await anyBox(page).fill(url); await anyBox(page).press("Enter"); await details(page).waitFor(); };
const adv = { mode: "advanced" };
const extras = (page) => details(page).getByRole("group", { name: "Tags and extras" });
const openExtras = async (page) => { await details(page).getByRole("button", { name: "Tags, cover art and audio" }).click(); };
const audio = (page) => details(page).getByRole("radio", { name: /Audio only/ }).click();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ================= tags, cover art, lyrics, audio =================
let page = await open({ store: { warnDuplicates: false } });
await card(page);
check("extras: tucked away until asked for", await extras(page).count() === 0);
await openExtras(page);
check("extras: six tag fields", await extras(page).getByLabel(/ tag$/).count() === 6);
check("extras: video downloads explain what applies", await extras(page).locator("text=Tags are saved inside the video file").count() === 1);
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
let req = await lastReq(page);
check("extras: untouched tags send nothing", req.extra.meta === null && req.extra.cover === null && req.extra.lyrics === null && req.extra.audio === null, JSON.stringify([req.extra.meta, req.extra.cover]));
await page.waitForTimeout(300);
await details(page).getByRole("button", { name: "Download again" }).click();
await audio(page);
await extras(page).getByLabel("Album tag").fill("Open Movies");
await extras(page).getByLabel("Year tag").fill("20x4");
check("extras: a bad year is flagged", await extras(page).getByRole("alert").locator("text=four digits").count() === 1);
check("extras: …and blocks the download", await details(page).getByRole("button", { name: "Download audio" }).isDisabled());
await extras(page).getByLabel("Year tag").fill("2008");
await extras(page).getByLabel("Track number tag").fill("0");
check("extras: track 0 is refused", await extras(page).getByRole("alert").locator("text=whole number from 1 to 999").count() === 1);
await extras(page).getByLabel("Track number tag").fill("3");
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 2);
req = await lastReq(page);
check("extras: only the edited tags are sent", same(req.extra.meta, { album: "Open Movies", year: "2008", track: "3" }), JSON.stringify(req.extra.meta));
check("extras: audio defaults", same(req.extra.cover, { mode: "default", path: null }) && req.extra.lyrics === "off" && same(req.extra.audio, { quality: null, normalize: false, trim_silence: false }), JSON.stringify([req.extra.cover, req.extra.lyrics, req.extra.audio]));
await page.context().close();

page = await open({ store: { warnDuplicates: false } });
await card(page);
await openExtras(page);
await audio(page);
await extras(page).getByLabel("Cover art").selectOption("custom");
check("cover: custom needs a picture", await details(page).getByRole("button", { name: "Download audio" }).isDisabled() && await extras(page).getByRole("alert").locator("text=Choose a picture").count() === 1);
await extras(page).getByRole("button", { name: "Choose picture…" }).click();
await extras(page).locator("text=cover.jpg").waitFor();
check("cover: the chosen picture is named", true);
await extras(page).getByLabel("Lyrics").selectOption("both");
await extras(page).getByLabel("Audio quality").selectOption("192K");
await extras(page).getByLabel("Even out the volume").check();
await extras(page).getByLabel("Trim silence at the start and end").check();
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("cover: custom picture and path are sent", same(req.extra.cover, { mode: "custom", path: "/home/u/cover.jpg" }), JSON.stringify(req.extra.cover));
check("extras: lyrics and audio processing are sent", req.extra.lyrics === "both" && same(req.extra.audio, { quality: "192K", normalize: true, trim_silence: true }), JSON.stringify(req.extra.audio));
await page.context().close();

page = await open({ store: { warnDuplicates: false } });
await card(page);
await openExtras(page);
await audio(page);
await extras(page).getByLabel("Cover art").selectOption("square");
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
check("cover: cropped square", (await lastReq(page)).extra.cover.mode === "square");
await page.context().close();

// ================= presets =================
page = await open({ store: { warnDuplicates: false } });
await card(page);
check("presets: none saved yet", await details(page).getByLabel("Preset").locator("option").first().textContent() === "None saved yet");
await details(page).getByRole("button", { name: "Save these choices…" }).click();
await details(page).getByRole("button", { name: "Save", exact: true }).click();
check("presets: a name is required", await details(page).getByRole("alert").locator("text=Give the preset a name").count() === 1);
await audio(page);
await openExtras(page);
await extras(page).getByLabel("Audio quality").selectOption("128K");
await extras(page).getByLabel("Even out the volume").check();
await extras(page).getByLabel("Cover art").selectOption("square");
await details(page).getByLabel("Preset name").fill("Podcast");
await details(page).getByLabel("Preset name").press("Enter");
await page.waitForTimeout(200);
const saved = (await settingsOf(page)).presets;
check("presets: saved with the choices", saved.length === 1 && saved[0].name === "Podcast" && saved[0].kind === "audio" && saved[0].audioQuality === "128K" && saved[0].normalize === true && saved[0].cover === "square", JSON.stringify(saved));
await details(page).getByRole("button", { name: "Save these choices…" }).click();
await details(page).getByLabel("Preset name").fill("podcast");
await details(page).getByRole("button", { name: "Save", exact: true }).click();
check("presets: duplicate names are refused", await details(page).getByRole("alert").locator("text=already exists").count() === 1);
await page.context().close();

page = await open({ store: { warnDuplicates: false, presets: [{ id: "p1", name: "Podcast", kind: "audio", quality: "best", subMode: "off", subLangs: "en", audioQuality: "128K", normalize: true, trimSilence: true, cover: "square", lyrics: "file" }] } });
await card(page);
await details(page).getByLabel("Preset").selectOption("p1");
check("presets: choosing one switches to audio", (await details(page).getByRole("radio", { name: /Audio only/ }).getAttribute("aria-checked")) === "true");
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("presets: its choices are what gets sent", req.preset === "audio" && req.extra.lyrics === "file" && req.extra.cover.mode === "square" && same(req.extra.audio, { quality: "128K", normalize: true, trim_silence: true }), JSON.stringify(req.extra));
await nav(page, "Settings").click();
check("presets: listed in Settings", await page.getByRole("group", { name: "Preset Podcast" }).count() === 1);
await page.getByRole("button", { name: "Delete preset Podcast" }).click();
check("presets: can be deleted", await page.getByRole("group", { name: "Preset Podcast" }).count() === 0 && (await settingsOf(page)).presets.length === 0);
await page.context().close();

page = await open({ store: { presets: "garbage" } });
check("presets: damaged saved data is ignored", true);
await page.context().close();

// ================= advanced: defaults and the command =================
page = await open({ store: { ...adv, audioNormalize: true, audioQuality: "192K", coverMode: "none", lyricsMode: "embed", warnDuplicates: false } });
await card(page);
await details(page).getByRole("button", { name: "Show the command" }).click();
check("command: Advanced can show it", await details(page).getByLabel("Command").locator("text=yt-dlp --no-playlist").count() === 1);
check("command: reflects the settings (volume)", await details(page).getByLabel("Command").locator("text=loudnorm").count() === 0, "video choice has no audio processing");
await details(page).getByRole("button", { name: "Copy" }).click();
await audio(page);
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("defaults: Advanced settings seed the card", req.extra.cover.mode === "none" && req.extra.lyrics === "embed" && req.extra.audio.quality === "192K" && req.extra.audio.normalize === true, JSON.stringify(req.extra));
await page.context().close();

page = await open();
await card(page);
check("command: not offered in Simple mode", await details(page).getByRole("button", { name: "Show the command" }).count() === 0);
await page.context().close();

// ================= heads up =================
for (const [mock, text] of [
  [{ availability: "needs_auth" }, "needs you to be signed in"],
  [{ availability: "subscriber_only" }, "channel members only"],
  [{ ageLimit: 18 }, "age-restricted"],
  [{ liveStatus: "is_upcoming" }, "hasn't started yet"],
]) {
  page = await open({ mock });
  await card(page);
  check(`heads up: ${text}`, await details(page).getByRole("list", { name: "Before you download" }).locator(`text=${text}`).count() === 1);
  await page.context().close();
}
page = await open();
await card(page);
check("heads up: nothing for an ordinary video", await details(page).getByRole("list", { name: "Before you download" }).count() === 0);
await page.context().close();

// ================= checking finished files =================
page = await open({ mock: { checkFails: true }, store: { warnDuplicates: false } });
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await nav(page, "Downloads").click();
await page.waitForSelector("text=Done, check it", { timeout: 15000 });
check("check: a damaged file is flagged in Downloads", await page.locator("text=Done, check it").count() === 1);
await page.getByRole("button", { name: /Big Buck Bunny/ }).first().click().catch(() => {});
check("check: …with the reason", await page.getByRole("alert").locator("text=may be cut off").count() === 1);
const hist = await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).history);
check("check: …and remembered in history", hist.length === 1 && /cut off/.test(hist[0].flag ?? ""), JSON.stringify(hist));
await nav(page, "History").click();
check("check: history shows the warning", await page.getByLabel(/Check this file/).count() === 1);
await page.context().close();

// ================= queue controls =================
const seed = (n) => Array.from({ length: n }, (_, i) => `https://www.youtube.com/watch?v=queue${String(i).padStart(6, "0")}`);
page = await open({ store: { ...adv, concurrency: 1, warnDuplicates: false }, mock: { dlDelay: 250 } });
await anyBox(page).fill(seed(4).join("\n"));
await anyBox(page).press("Enter");
await results(page).waitFor();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: /Download 4 videos/ }).click();
await nav(page, "Downloads").click();
await waitCalls(page, "start_download", 1);
const rowOf = (n) => page.locator("tr", { hasText: new RegExp(`queue00000${n}`) }).first();
check("queue: waiting items can be moved", await page.getByRole("button", { name: "Download this next" }).count() >= 2);
// items 1,2,3 are waiting; send item 3 next and item 1 last
await rowOf(3).getByRole("button", { name: "Download this next" }).click();
await rowOf(1).getByRole("button", { name: "Download this last" }).click();
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "start_download").length >= 4, null, { timeout: 40000 });
const order = (await calls(page, "start_download")).map((c) => c.args.req.url.slice(-1));
check("queue: order follows the moves", same(order, ["0", "3", "2", "1"]), JSON.stringify(order));
await page.context().close();

// per-website limit
page = await open({ store: { ...adv, concurrency: 3, perSiteLimit: 1, warnDuplicates: false }, mock: { dlDelay: 400 } });
await anyBox(page).fill(seed(3).join("\n"));
await anyBox(page).press("Enter");
await results(page).waitFor();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: /Download 3 videos/ }).click();
await page.waitForTimeout(1200);
check("queue: one website at a time when limited", (await calls(page, "start_download")).length === 1, String((await calls(page, "start_download")).length));
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "start_download").length >= 3, null, { timeout: 60000 });
check("queue: the rest follow as each finishes", true);
await page.context().close();

// retry after network errors
page = await open({ store: { ...adv, autoRetries: 2, warnDuplicates: false } });
await card(page, "https://www.youtube.com/watch?v=flaky000001");
await details(page).getByRole("button", { name: "Download video" }).click();
await nav(page, "Downloads").click();
await page.waitForSelector("text=Trying again soon", { timeout: 10000 });
check("retry: a network failure is retried, and says so", true);
await page.waitForSelector(".progress.done", { timeout: 40000 });
check("retry: …and then succeeds", (await calls(page, "start_download")).length === 2);
await page.context().close();

page = await open({ store: { ...adv, autoRetries: 0, warnDuplicates: false } });
await card(page, "https://www.youtube.com/watch?v=flaky000002");
await details(page).getByRole("button", { name: "Download video" }).click();
await nav(page, "Downloads").click();
await page.waitForSelector("text=Failed", { timeout: 10000 });
check("retry: off means it just fails", (await calls(page, "start_download")).length === 1);
await page.context().close();

page = await open({ store: { autoRetries: 3, warnDuplicates: false } });
await card(page, "https://www.youtube.com/watch?v=flaky000003");
await details(page).getByRole("button", { name: "Download video" }).click();
await nav(page, "Downloads").click();
await page.waitForSelector("text=Failed", { timeout: 10000 });
check("retry: Simple mode never retries on its own", (await calls(page, "start_download")).length === 1);
await page.context().close();

// ================= canonical links =================
const OLD = { id: "o1", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "Old video", thumbnail: "", preset: "best", path: "/home/u/Downloads/o1.mp4", timestamp: now - 3600_000 };
page = await open({ history: [OLD] });
await card(page, "https://youtu.be/aaaaaaaaaaa?si=share");
check("links: a short link finds the earlier download", await details(page).getByRole("list", { name: "Already downloaded" }).count() === 1);
await details(page).getByRole("button", { name: "Download again" }).click();
await details(page).getByRole("button", { name: "Download video" }).click();
await page.getByRole("alertdialog").waitFor();
check("links: …and asks before repeating it", await page.getByRole("alertdialog").locator("text=You already downloaded this").count() === 1);
await page.context().close();

// ================= themes =================
page = await open();
check("theme: Aqua by default", (await page.evaluate(() => document.documentElement.dataset.theme)) === "aqua");
await nav(page, "Settings").click();
await page.getByLabel("Theme").selectOption("dark");
check("theme: Dark applies at once", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark" && (await settingsOf(page)).theme === "dark");
await page.getByLabel("Theme").selectOption("graphite");
check("theme: Graphite", (await page.evaluate(() => document.documentElement.dataset.theme)) === "graphite");
await page.reload();
await page.waitForSelector("input[type=text]");
check("theme: remembered after a restart", (await page.evaluate(() => document.documentElement.dataset.theme)) === "graphite");
await page.getByLabel("Theme").count();
await page.context().close();

page = await open({ store: { theme: "system" } });
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForFunction(() => document.documentElement.dataset.theme === "dark", null, { timeout: 3000 }).catch(() => {});
check("theme: 'match my system' follows a dark system", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
await page.emulateMedia({ colorScheme: "light" });
await page.waitForFunction(() => document.documentElement.dataset.theme === "aqua", null, { timeout: 3000 }).catch(() => {});
check("theme: …and goes back to light", (await page.evaluate(() => document.documentElement.dataset.theme)) === "aqua");
await page.context().close();

page = await open({ store: { theme: "bogus" } });
check("theme: an unknown saved theme falls back to Aqua", (await page.evaluate(() => document.documentElement.dataset.theme)) === "aqua");
await page.context().close();

// ================= validation and safety =================
page = await open();
await nav(page, "Settings").click();
check("folder: ready message with free space", await page.getByLabel("Download folder check").locator("text=/Ready\\. .* free/").count() === 1);
await page.getByLabel("Proxy", { exact: true }).fill("ftp://nope");
check("proxy: a bad scheme is flagged as typed", await page.locator("section[aria-label='Network']").getByRole("alert").locator("text=aren't supported").count() === 1 && await page.getByRole("button", { name: "Test proxy" }).isDisabled());
await page.getByLabel("Proxy", { exact: true }).fill("host with space");
check("proxy: spaces are flagged", await page.locator("section[aria-label='Network']").getByRole("alert").locator("text=can't contain spaces").count() === 1);
await page.getByLabel("Proxy", { exact: true }).fill("127.0.0.1:8080");
check("proxy: a good address clears the warning", await page.locator("section[aria-label='Network']").getByRole("alert").count() === 0);
await page.context().close();

page = await open({ store: adv });
await nav(page, "Settings").click();
await page.getByLabel("Speed limit", { exact: true }).fill("fast");
check("speed limit: flagged as typed", await page.getByRole("alert").locator("text=like 500K or 2M").count() === 1);
await page.getByLabel("Speed limit", { exact: true }).fill("2M");
check("speed limit: fine once valid", await page.getByRole("alert").locator("text=like 500K or 2M").count() === 0);
await page.getByLabel("Default audio quality").fill("loud");
check("audio quality: flagged as typed", await page.getByRole("alert").locator("text=Use 0 to 9").count() === 1);
await page.getByLabel("Default audio quality").fill("192K");
check("audio quality: fine once valid", await page.getByRole("alert").locator("text=Use 0 to 9").count() === 0);
await page.context().close();

page = await open({ mock: { folderProblem: "Kaisu can't write to that folder. Choose another one." } });
await nav(page, "Settings").click();
check("folder: a problem is shown in Settings", await page.getByLabel("Download folder check").locator("text=can't write to that folder").count() === 1);
await nav(page, "Search").click();
await card(page);
await details(page).getByRole("button", { name: "Download video" }).click();
await page.getByRole("status").filter({ hasText: "can't write to that folder" }).waitFor();
check("folder: …and blocks downloading, with the reason", (await calls(page, "start_download")).length === 0);
await page.context().close();

// ================= accent colours =================
page = await open();
check("accent: blue by default", (await page.evaluate(() => document.documentElement.dataset.accent)) === "blue");
const primaryFilter = async (sel) => page.evaluate((q) => getComputedStyle(document.querySelector(q)).filter, sel);
await nav(page, "Settings").click();
const accents = await page.getByLabel("Accent colour").locator("option").allTextContents();
check("accent: the choices", JSON.stringify(accents) === JSON.stringify(["Blue", "Orange", "Green", "Purple", "Pink", "Red", "Teal"]), JSON.stringify(accents));
check("accent: blue leaves the colours alone", (await primaryFilter(".sidebar")) === "none");
await page.getByLabel("Accent colour").selectOption("orange");
check("accent: orange applies and is saved", (await page.evaluate(() => document.documentElement.dataset.accent)) === "orange" && (await settingsOf(page)).accent === "orange");
check("accent: the sidebar is turned to orange", /hue-rotate\(175deg\)/.test(await primaryFilter(".sidebar")), await primaryFilter(".sidebar"));
check("accent: the toolbar keeps its silver", (await primaryFilter(".toolbar")) === "none");
await nav(page, "Search").click();
await card(page);
check("accent: the download button follows", /hue-rotate\(175deg\)/.test(await primaryFilter(".btn.primary")));
await page.getByLabel("Search source").count();
await nav(page, "Settings").click();
for (const a of ["green", "purple", "pink", "red", "teal"]) {
  await page.getByLabel("Accent colour").selectOption(a);
  check(`accent: ${a}`, (await page.evaluate(() => document.documentElement.dataset.accent)) === a && /hue-rotate\(/.test(await primaryFilter(".sidebar")));
}
await page.reload();
await page.waitForSelector("input[type=text]");
check("accent: remembered after a restart", (await page.evaluate(() => document.documentElement.dataset.accent)) === "teal");
await page.context().close();

page = await open({ store: { accent: "plaid" } });
check("accent: an unknown saved colour falls back to blue", (await page.evaluate(() => document.documentElement.dataset.accent)) === "blue");
await page.context().close();

await done();
