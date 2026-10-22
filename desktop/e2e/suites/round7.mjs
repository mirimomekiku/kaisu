// Queue order and per-download speed limits, site rules, the custom-arguments allowlist in Settings, the masked proxy box,
// YouTube Music search, unfinished downloads, the in-app player, previews and converting to audio.
import { fileAction, open, check, calls, waitCalls, box, nav, results, details, submit, now, done } from "../harness.mjs";

const DL = "/home/u/Downloads";
const DAY = 86_400_000;
const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings);
const historyOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).history);
const lastReq = async (page) => (await calls(page, "start_download")).at(-1).args.req;
const dialog = (page) => page.getByRole("alertdialog");
const sheet = (page, name) => page.getByRole("dialog", { name });
const H = (id, title, preset, path, ageDays = 1, extra = {}) => ({ id, url: `https://www.youtube.com/watch?v=${id.padEnd(11, "0")}`, title, thumbnail: "", preset, path, timestamp: now - ageDays * DAY, ...extra });
const adv = { mode: "advanced", warnDuplicates: false, lyricsConsent: true };
const VIDEO = "https://www.youtube.com/watch?v=pasted00001";

// ================= queue order and per-download speed limits =================
let page = await open({ store: { warnDuplicates: false }, mock: { dlDelay: 700 } });
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
for (const i of [1, 2, 3, 4]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${i}$`)).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 4 videos" }).click();
await nav(page, "Downloads").click();
const rowOf = (n) => page.locator("tr", { hasText: `lofi beats — result ${n}` }).first();
await rowOf(4).waitFor();
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 4);
check("queue: the one that starts next says so", (await rowOf(3).innerText()).includes("#1") && (await rowOf(4).innerText()).includes("#2"), `${await rowOf(3).innerText()} | ${await rowOf(4).innerText()}`);
check("queue: running ones have no place in line", !/#\d/.test(await rowOf(1).innerText()));
check("queue: a waiting row can be dragged", (await rowOf(4).getAttribute("draggable")) === "true" && (await rowOf(1).getAttribute("draggable")) === null);
await rowOf(4).dragTo(rowOf(3));
await page.waitForFunction(() => [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes("result 4"))?.textContent.includes("#1"));
check("queue: dropping a row on another changes who starts first", (await rowOf(4).innerText()).includes("#1") && (await rowOf(3).innerText()).includes("#2"), `${await rowOf(4).innerText()} | ${await rowOf(3).innerText()}`);
check("queue: running downloads stay where they were", (await rowOf(1).getAttribute("draggable")) === null && !/#\d/.test(await rowOf(2).innerText()));
await page.context().close();

// the order is what actually runs
page = await open({ store: { warnDuplicates: false, concurrency: 1, mode: "advanced" }, mock: { dlDelay: 120 } });
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
for (const i of [1, 2, 3]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${i}$`)).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 3 videos" }).click();
await nav(page, "Downloads").click();
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 3);
await page.locator("tr", { hasText: "result 3" }).first().dragTo(page.locator("tr", { hasText: "result 2" }).first());
await waitCalls(page, "start_download", 3, 30000);
const order = (await calls(page, "start_download")).map((c) => c.args.req.url.split("=").pop());
check("queue: downloads start in the order they were arranged", order.length === 3 && order[0].includes("0000000") && JSON.stringify(order) !== "[]", JSON.stringify(order));
await page.context().close();

// a speed limit for one download
page = await open({ store: { warnDuplicates: false }, mock: { dlDelay: 700 } });
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
for (const i of [1, 2, 3]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${i}$`)).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 3 videos" }).click();
await nav(page, "Downloads").click();
await rowOf(3).waitFor();
await rowOf(3).getByRole("button", { name: "Speed limit" }).click();
await sheet(page, "Speed limit").waitFor();
await sheet(page, "Speed limit").getByLabel("Speed limit").fill("fast please");
check("limit: a bad value is explained and can't be set", (await sheet(page, "Speed limit").getByRole("alert").count()) === 1 && (await sheet(page, "Speed limit").getByRole("button", { name: "Set limit" }).isDisabled()));
await sheet(page, "Speed limit").getByRole("button", { name: "500K", exact: true }).click();
check("limit: a quick choice fills the box", (await sheet(page, "Speed limit").getByLabel("Speed limit").inputValue()) === "500K");
await sheet(page, "Speed limit").getByRole("button", { name: "Set limit" }).click();
check("limit: the dialog closes", (await sheet(page, "Speed limit").count()) === 0);
check("limit: the row shows it", (await rowOf(3).innerText()).includes("500K/s"));
await waitCalls(page, "start_download", 3, 30000);
const third = (await calls(page, "start_download")).map((c) => c.args.req).find((r) => r.url.endsWith("0000000002") || r.extra.rate_limit === "500K");
check("limit: it is what that download starts with", third?.extra.rate_limit === "500K", JSON.stringify(third?.extra.rate_limit));
check("limit: the others keep the usual speed", (await calls(page, "start_download")).filter((c) => c.args.req.extra.rate_limit === "500K").length === 1);
await page.context().close();

// slowing down a download that is running restarts it with the new limit
page = await open({ store: { warnDuplicates: false }, mock: { dlDelay: 400 } });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await nav(page, "Downloads").click();
await waitCalls(page, "start_download", 1);
await page.locator("tr").nth(1).getByRole("button", { name: "Speed limit" }).click();
await sheet(page, "Speed limit").getByLabel("Speed limit").fill("2M");
check("limit: a running download says it will restart", (await sheet(page, "Speed limit").innerText()).includes("restarts for a moment"));
await sheet(page, "Speed limit").getByRole("button", { name: "Set limit" }).click();
await waitCalls(page, "cancel_download", 1);
await waitCalls(page, "start_download", 2, 20000);
check("limit: it carries on with the new limit", (await lastReq(page)).extra.rate_limit === "2M");
await page.context().close();

// ================= site rules =================
page = await open({ store: { ...adv } });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
const rules = page.locator("section[aria-label='Site rules']");
check("rules: offered in Advanced mode", (await rules.count()) === 1);
await rules.getByRole("button", { name: "Add a rule" }).click();
check("rules: a new rule says what is missing", (await rules.getByRole("alert").innerText()).includes("Enter the site"));
await rules.getByLabel("Site (rule 1)").fill("example.com");
check("rules: it needs something to do", (await rules.getByRole("alert").innerText()).includes("Choose what the rule should do"));
await rules.getByLabel("Download as (rule 1)").selectOption("audio");
await rules.getByLabel("Audio format (rule 1)").selectOption("flac");
await rules.getByLabel("Folder (rule 1)", { exact: true }).fill("Podcasts");
check("rules: a folder must be a full path", (await rules.getByRole("alert").innerText()).includes("full path"));
await rules.getByRole("button", { name: "Choose folder (rule 1)" }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).settings.siteRules?.[0]?.folder === "/home/u/Videos");
check("rules: the folder can be chosen", true);
check("rules: it is described in words", (await rules.innerText()).includes("Anything from example.com is downloaded as audio, audio as FLAC, saved in /home/u/Videos."));
let st = await settingsOf(page);
check("rules: saved", st.siteRules.length === 1 && st.siteRules[0].host === "example.com" && st.siteRules[0].preset === "audio" && st.siteRules[0].audioFormat === "flac");
await nav(page, "Search").click();
await submit(page, "https://example.com/watch?v=abc");
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
let req = await lastReq(page);
check("rules: a matching site is downloaded as the rule says", req.preset === "audio" && req.extra.audio_format === "flac" && req.out_dir === "/home/u/Videos", JSON.stringify([req.preset, req.extra.audio_format, req.out_dir]));
await page.getByRole("status").filter({ hasText: "site rule for example.com" }).waitFor();
check("rules: and it says a rule was used", true);
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 2);
req = await lastReq(page);
check("rules: other sites are left alone", req.preset === "best" && req.out_dir === DL, JSON.stringify([req.preset, req.out_dir]));
await page.context().close();

page = await open({ store: { mode: "simple", warnDuplicates: false, siteRules: [{ id: "r", host: "example.com", channel: "", preset: "audio", audioFormat: "flac", folder: "" }] } });
await submit(page, "https://example.com/watch?v=abc");
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
check("rules: Simple mode ignores them", (await lastReq(page)).preset === "best");
await page.context().close();

page = await open({ store: { ...adv, siteRules: [{ id: "r", host: "example.com", channel: "", preset: "", audioFormat: "", folder: "/mnt/gone/Podcasts" }] }, mock: { badFolders: ["/mnt/gone/Podcasts"] } });
await submit(page, "https://example.com/watch?v=abc");
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
await page.getByRole("status").filter({ hasText: "A site rule's folder can't be used" }).waitFor();
check("rules: a folder that can't be used falls back to the usual one, and says so", (await lastReq(page)).out_dir === DL);
await page.context().close();

// ================= custom arguments =================
page = await open({ store: { ...adv } });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
const argsBox = page.getByLabel("Custom yt-dlp arguments");
await argsBox.fill("--retries 3");
await page.waitForTimeout(500);
check("args: an allowed option raises no complaint", (await page.getByRole("alert").filter({ hasText: "can run programs" }).count()) === 0);
await argsBox.fill("--exec calc");
await page.getByRole("alert").filter({ hasText: "can run programs" }).waitFor();
check("args: a refused option is explained while typing", (await argsBox.getAttribute("aria-invalid")) === "true");
await page.getByText("Allowed options", { exact: true }).click();
check("args: the list of allowed options can be opened", (await page.getByRole("list", { name: "Allowed options" }).locator("li").count()) >= 3 && (await page.getByRole("list", { name: "Allowed options" }).innerText()).includes("--retries"));
await page.context().close();

// ================= the proxy box hides the password =================
page = await open({ store: { proxy: "socks5://me@127.0.0.1:1080", warnDuplicates: false }, mock: { secrets: { "proxy-password": "hunter2" } } });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
const proxyBox = page.getByLabel("Proxy", { exact: true });
const cover = () => page.locator("[data-proxy-cover]");
check("proxy box: the password is covered", (await cover().innerText()) === "socks5://me:***@127.0.0.1:1080", await cover().innerText());
await proxyBox.focus();
check("proxy box: it shows while editing", (await cover().count()) === 0 && (await proxyBox.inputValue()) === "socks5://me:hunter2@127.0.0.1:1080");
await proxyBox.blur();
check("proxy box: and is covered again", (await cover().count()) === 1);
await page.getByRole("button", { name: "Show the proxy password" }).click();
check("proxy box: the eye shows it", (await cover().count()) === 0);
await page.getByRole("button", { name: "Hide the proxy password" }).click();
check("proxy box: …and covers it", (await cover().count()) === 1);
// Tabbing in selects the text; typing then replaces it, as in any other box.
await proxyBox.focus();
await proxyBox.fill("socks5://127.0.0.1:9");
check("proxy box: typing over it replaces the text instead of adding to it", (await proxyBox.inputValue()) === "socks5://127.0.0.1:9");
check("proxy box: nothing is lost by looking", (await calls(page, "secret_set")).length === 0);
await page.context().close();

// ================= YouTube Music =================
page = await open({ store: { warnDuplicates: false } });
await page.getByLabel("Search source").selectOption("youtube_music");
await page.getByLabel(/^Search YouTube Music/).fill("daft punk");
await page.getByLabel(/^Search YouTube Music/).press("Enter");
await results(page).waitFor();
check("music: searches YouTube Music", (await calls(page, "search_media")).at(-1).args.source === "youtube_music" && (await settingsOf(page)).searchSource === "youtube_music");
check("music: the box says where it searches", (await page.getByLabel(/^Search YouTube Music/).count()) === 1);
await page.context().close();

// ================= unfinished downloads =================
const LEFT = [
  { path: `${DL}/Song [abcdefghijk].f251.m4a.part`, name: "Song [abcdefghijk].f251.m4a", size: 5_000_000, modified: 1, video_id: "abcdefghijk", audio_only: true },
  { path: `${DL}/Other [abcdefghijk].f137.mp4.part`, name: "Other [abcdefghijk].f137.mp4", size: 9_000_000, modified: 2, video_id: "abcdefghijk", audio_only: false },
  { path: `${DL}/Mystery.mp4.part`, name: "Mystery.mp4", size: 1_000_000, modified: 3, video_id: null, audio_only: false },
];
page = await open({ store: { warnDuplicates: false }, mock: { leftovers: LEFT } });
const banner = () => page.getByRole("status", { name: "Unfinished downloads" });
await banner().waitFor();
check("leftovers: unfinished downloads are announced with their size", (await banner().innerText()).includes("3 unfinished downloads") && (await banner().innerText()).includes("MB"));
await banner().getByRole("button", { name: "Resume as audio" }).click();
await waitCalls(page, "start_download", 1);
req = await lastReq(page);
check("leftovers: resuming asks for the video again, once, as chosen", req.url === "https://www.youtube.com/watch?v=abcdefghijk" && req.preset === "audio" && (await calls(page, "start_download")).length === 1, JSON.stringify([req.url, req.preset]));
await page.waitForFunction(() => document.querySelector("[aria-label='Unfinished downloads']")?.textContent.includes("1 unfinished download "));
check("leftovers: what can't be resumed stays listed, without resume buttons", (await banner().getByRole("button", { name: /Resume/ }).count()) === 0 && (await banner().getByRole("button", { name: "Delete them" }).count()) === 1);
await banner().getByRole("button", { name: "Delete them" }).click();
await dialog(page).getByRole("button", { name: "Delete them" }).click();
await waitCalls(page, "remove_leftovers", 1);
check("leftovers: deleting asks first, then removes just those", JSON.stringify((await calls(page, "remove_leftovers"))[0].args.paths) === JSON.stringify([`${DL}/Mystery.mp4.part`]));
await page.waitForFunction(() => !document.querySelector("[aria-label='Unfinished downloads']"));
check("leftovers: the banner goes away", true);
await page.context().close();

page = await open({ store: { warnDuplicates: false }, mock: { leftovers: LEFT } });
await banner().getByRole("button", { name: "Not now" }).click();
check("leftovers: 'Not now' hides it and deletes nothing", (await banner().count()) === 0 && (await calls(page, "remove_leftovers")).length === 0);
await page.context().close();

page = await open({ store: { warnDuplicates: false } });
await page.waitForTimeout(600);
check("leftovers: nothing is shown when there are none", (await banner().count()) === 0 && (await calls(page, "find_leftovers")).length === 1);
await page.context().close();

page = await open({ store: { warnDuplicates: false }, queue: [{ id: "q1", title: "Old one", url: "https://www.youtube.com/watch?v=old00000001", thumbnail: "", preset: "best", outDir: DL, extra: {}, status: "downloading", progress: 40 }], mock: { leftovers: LEFT } });
await page.waitForTimeout(800);
check("leftovers: not looked for while there is unfinished work in the queue", (await calls(page, "find_leftovers")).length === 0 && (await banner().count()) === 0);
await page.context().close();

// ================= the player =================
const MOVIE = H("mv", "My Movie", "best", `${DL}/My Movie.mp4`);
const SONG = H("sg", "My Song", "audio", `${DL}/My Song.mp3`, 2);
page = await open({ history: [MOVIE, SONG], store: { warnDuplicates: false } });
await nav(page, "History").click();
await page.locator("tr", { hasText: "My Movie" }).first().getByRole("button", { name: "Play in Kaisu" }).click();
await sheet(page, "My Movie").waitFor();
await page.waitForFunction(() => document.querySelector("[role=dialog] video")?.getAttribute("src"));
check("player: the file is made available to the page, then played in a video player", (await calls(page, "play_in_app")).at(-1).args.path === `${DL}/My Movie.mp4` && (await sheet(page, "My Movie").locator("video").count()) === 1);
check("player: nothing to complain about", (await sheet(page, "My Movie").getByRole("alert").count()) === 0);
await sheet(page, "My Movie").getByRole("button", { name: "Close", exact: true }).click();
check("player: Close closes it", (await sheet(page, "My Movie").count()) === 0);
await page.locator("tr", { hasText: "My Song" }).first().getByRole("button", { name: "Play in Kaisu" }).click();
await page.getByRole("region", { name: "Music player" }).waitFor();
check("player: sound files play in the player bar, not a window", (await page.getByRole("dialog").count()) === 0 && (await page.getByRole("region", { name: "Music player" }).innerText()).includes("My Song"));
await page.getByRole("button", { name: "Close the player" }).click();
check("player: the bar can be closed", (await page.getByRole("region", { name: "Music player" }).count()) === 0);
await page.context().close();

page = await open({ history: [MOVIE], store: { warnDuplicates: false }, mock: { unplayable: true } });
await nav(page, "History").click();
await page.locator("tr", { hasText: "My Movie" }).first().getByRole("button", { name: "Play in Kaisu" }).click();
await sheet(page, "My Movie").getByRole("alert").waitFor();
check("player: a format it can't play is explained, with a way out", (await sheet(page, "My Movie").getByRole("button", { name: "Open in your player" }).count()) === 1);
await sheet(page, "My Movie").getByRole("button", { name: "Open in your player" }).click();
await waitCalls(page, "open_file", 1);
check("player: …which opens the system player", (await calls(page, "open_file")).at(-1).args.path === `${DL}/My Movie.mp4`);
await page.context().close();

page = await open({ history: [MOVIE], store: { warnDuplicates: false }, mock: { playRefused: true } });
await nav(page, "History").click();
await page.locator("tr", { hasText: "My Movie" }).first().getByRole("button", { name: "Play in Kaisu" }).click();
await page.getByRole("status").filter({ hasText: "isn't in a download folder" }).waitFor();
check("player: a refused file is reported and no player is left open", (await page.getByRole("dialog").count()) === 0);
await page.context().close();

// ================= preview before downloading =================
page = await open({ store: { warnDuplicates: false } });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Preview" }).click();
await sheet(page, /^Preview: /).waitFor();
await page.waitForFunction(() => document.querySelector("[role=dialog] video")?.getAttribute("src"));
check("preview: a short clip of that link is fetched and played", (await calls(page, "preview_clip")).at(-1).args.url === VIDEO && (await calls(page, "download_nothing")).length === 0 && (await calls(page, "start_download")).length === 0);
await sheet(page, /^Preview: /).getByRole("button", { name: "Close", exact: true }).click();
await waitCalls(page, "discard_preview", 1);
check("preview: closing it deletes the clip", (await calls(page, "discard_preview"))[0].args.path === "/cache/preview/abc.mp4");
await page.context().close();

page = await open({ store: { warnDuplicates: false }, mock: { previewDelay: 800 } });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Preview" }).click();
await sheet(page, /^Preview: /).getByRole("status").waitFor();
await sheet(page, /^Preview: /).getByRole("button", { name: "Close", exact: true }).click();
await waitCalls(page, "discard_preview", 1, 8000);
check("preview: closing before it arrives still cleans it up", (await page.getByRole("dialog").count()) === 0);
await page.context().close();

page = await open({ store: { warnDuplicates: false }, mock: { previewFail: true } });
await submit(page, VIDEO);
await details(page).waitFor();
await details(page).getByRole("button", { name: "Preview" }).click();
await page.getByRole("status").filter({ hasText: "Previews wait until your downloads have finished" }).waitFor();
check("preview: a refusal is explained", (await page.getByRole("dialog").count()) === 0);
await page.context().close();

page = await open({ store: { warnDuplicates: false }, mock: { live: true } });
await submit(page, VIDEO);
await details(page).waitFor();
check("preview: not offered for a live stream", (await details(page).getByRole("button", { name: "Preview" }).count()) === 0);
await page.context().close();

// ================= convert later =================
page = await open({ history: [MOVIE, SONG], store: { warnDuplicates: false } });
await nav(page, "History").click();
await fileAction(page.locator("tr", { hasText: "My Movie" }).first(), "Convert to audio");
check("convert: offers audio formats, starting with MP3", (await sheet(page, "Convert to audio").getByRole("radio").count()) === 5 && (await sheet(page, "Convert to audio").getByRole("radio").first().isChecked()));
await sheet(page, "Convert to audio").getByLabel(/^Opus/).check();
await sheet(page, "Convert to audio").getByRole("button", { name: "Convert" }).click();
await waitCalls(page, "convert_audio", 1);
check("convert: asks for the chosen format on that file", JSON.stringify((await calls(page, "convert_audio"))[0].args) === JSON.stringify({ path: `${DL}/My Movie.mp4`, format: "opus" }), JSON.stringify((await calls(page, "convert_audio"))[0].args));
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).history.some((h) => h.path === "/home/u/Downloads/My Movie.opus"));
const converted = (await historyOf(page)).find((h) => h.path === `${DL}/My Movie.opus`);
check("convert: the new file joins History as audio, the original stays", converted?.preset === "audio" && converted.title === "My Movie" && (await historyOf(page)).some((h) => h.path === `${DL}/My Movie.mp4`));
check("convert: the dialog closes", (await sheet(page, "Convert to audio").count()) === 0);
await fileAction(page.locator("tr", { hasText: "My Song" }).first(), "Convert to audio");
check("convert: a file isn't offered its own format", (await sheet(page, "Convert to audio").getByRole("radio").count()) === 4 && (await sheet(page, "Convert to audio").getByLabel(/^MP3/).count()) === 0);
await sheet(page, "Convert to audio").getByRole("button", { name: "Cancel" }).click();
await page.context().close();

page = await open({ history: [MOVIE], store: { warnDuplicates: false }, mock: { convertFail: true } });
await nav(page, "History").click();
await fileAction(page.locator("tr", { hasText: "My Movie" }).first(), "Convert to audio");
await sheet(page, "Convert to audio").getByRole("button", { name: "Convert" }).click();
await sheet(page, "Convert to audio").getByRole("alert").waitFor();
check("convert: a failure is shown in the dialog, which stays open to try again", (await sheet(page, "Convert to audio").getByRole("alert").innerText()).includes("not enough free space") && (await sheet(page, "Convert to audio").getByRole("button", { name: "Convert" }).isEnabled()));
await page.context().close();

await done();
