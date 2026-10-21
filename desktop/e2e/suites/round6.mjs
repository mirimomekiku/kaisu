// Hardening: folders held by the backend, companion-file warnings, thumbnails fetched by Kaisu, the lyrics consent, the
// proxy password kept out of the settings file, and the power countdown kept by the backend.
import { open, check, calls, waitCalls, box, nav, results, details, submit, now, done } from "../harness.mjs";

const DL = "/home/u/Downloads";
const USB = "/mnt/usb/Kaisu";
const DAY = 86_400_000;
const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings);
const lastReq = async (page) => (await calls(page, "start_download")).at(-1).args.req;
const dialog = (page) => page.getByRole("alertdialog");
const H = (id, title, preset, path, ageDays = 1, extra = {}) => ({ id, url: `https://www.youtube.com/watch?v=${id.padEnd(11, "0")}`, title, thumbnail: "", preset, path, timestamp: now - ageDays * DAY, ...extra });
const keys = (o) => JSON.stringify(Object.keys(o).sort());
const order = (page) => page.evaluate(() => window.__mock.calls.map((c) => c.cmd));
const moveStore = { moveEnabled: true, moveDir: USB, warnDuplicates: false };
const tick = async (page, seconds) => { for (let i = 0; i < seconds; i++) { await page.clock.runFor(1000); await page.waitForTimeout(25); } };
const url = "https://www.youtube.com/watch?v=pasted00001";
const audioCard = async (page) => {
  await submit(page, url);
  await details(page).waitFor();
  await details(page).getByRole("radio", { name: /Audio only/ }).click();
  await details(page).getByRole("button", { name: /Tags, cover art and audio/ }).click();
};

// ================= folders are held by the backend =================
let page = await open({ history: [H("aaa", "Alpha video", "best", `${DL}/Alpha.mp4`)], store: moveStore });
await waitCalls(page, "transfer_files", 1, 20000);
let reg = await calls(page, "set_managed_folders");
check("folders: the download and move folders are registered", reg.length >= 1 && reg[0].args.download === DL && reg[0].args.moved === USB, JSON.stringify(reg.map((r) => r.args)));
const cmds = await order(page);
check("folders: registered before anything is moved", cmds.indexOf("set_managed_folders") < cmds.indexOf("transfer_files"), cmds.join(","));
check("folders: a move names no folders itself", keys((await calls(page, "transfer_files"))[0].args) === keys({ items: 1, mode: 1, conflict: 1, keepLayout: 1 }), keys((await calls(page, "transfer_files"))[0].args));
await page.context().close();

page = await open({ history: [H("old", "Old video", "best", `${DL}/Old.mp4`, 40), H("usb", "Old on the drive", "best", `${USB}/Usb.mp4`, 90)], store: { ...moveStore, autoDeleteDays: 30, autoDeleteMoved: true, moveWhen: "manual" } });
await waitCalls(page, "delete_files", 1, 30000);
let del = (await calls(page, "delete_files"))[0].args;
check("folders: a delete names no folders, only whether the drive's folder counts", keys(del) === keys({ paths: 1, includeMoved: 1 }) && del.includeMoved === true, JSON.stringify(del));
check("folders: …and registration came first", (await order(page)).indexOf("set_managed_folders") < (await order(page)).indexOf("delete_files"));
await page.context().close();

page = await open({ history: [H("old", "Old video", "best", `${DL}/Old.mp4`, 40)], store: { autoDeleteDays: 30 } });
await waitCalls(page, "delete_files", 1, 30000);
check("folders: the drive's folder isn't included unless asked for", (await calls(page, "delete_files"))[0].args.includeMoved === false);
await page.context().close();

page = await open({ store: { moveEnabled: true, moveDir: "/home/u", warnDuplicates: false }, mock: { folderProblem: "Moving and deleting are turned off for the folder for moved downloads (/home/u) because it is your user folder, or contains it. Choose a more specific folder." } });
await page.getByRole("status").filter({ hasText: "Moving and deleting are turned off" }).waitFor();
check("folders: a folder that is too broad is explained", true);
await page.context().close();

// ================= a companion file that couldn't follow =================
page = await open({ history: [H("aaa", "Alpha video", "best", `${DL}/Alpha.mp4`)], store: moveStore, mock: { transferWarn: [`${DL}/Alpha.mp4`] } });
await waitCalls(page, "transfer_files", 1, 20000);
await page.getByRole("status").filter({ hasText: "but not everything that goes with it" }).waitFor();
check("move: a subtitle or lyrics file that didn't follow is reported", true);
await page.context().close();

// ================= thumbnails =================
const T1 = "https://i.ytimg.com/vi/aaa/mqdefault.jpg";
const T2 = "https://cdn.example.org/broken.jpg";
const INLINE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>";
page = await open({
  history: [H("t1", "Has a picture", "best", null, 1, { thumbnail: T1 }), H("t2", "Broken picture", "best", null, 2, { thumbnail: T2 }), H("t3", "Inline picture", "best", null, 3, { thumbnail: INLINE }), H("t4", "Same picture again", "audio", null, 4, { thumbnail: T1 })],
  store: { proxy: "socks5://127.0.0.1:1080" },
  mock: { thumbFail: [T2] },
});
await nav(page, "History").click();
await waitCalls(page, "fetch_thumbnail", 2);
await page.waitForTimeout(400);
const fetched = (await calls(page, "fetch_thumbnail")).map((c) => c.args);
check("thumbs: each web picture is fetched once, even when shown twice", fetched.length === 2 && fetched.filter((a) => a.url === T1).length === 1 && fetched.some((a) => a.url === T2), JSON.stringify(fetched));
check("thumbs: …through the proxy", fetched.every((a) => a.proxy === "socks5://127.0.0.1:1080"));
check("thumbs: a picture already in the app isn't fetched", !fetched.some((a) => a.url === INLINE));
const srcs = await page.locator(".thumb img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));
check("thumbs: shown from memory, never straight from the internet", srcs.length === 3 && srcs.every((s) => s.startsWith("blob:") || s.startsWith("data:")) && srcs.filter((s) => s.startsWith("blob:")).length === 2, JSON.stringify(srcs));
check("thumbs: a picture that fails shows the placeholder instead", (await page.locator("tr", { hasText: "Broken picture" }).first().locator(".thumb img").count()) === 0 && (await page.locator("tr", { hasText: "Broken picture" }).first().locator(".thumb svg").count()) === 1);
await page.context().close();

// only what is near the screen is fetched
page = await open({ history: Array.from({ length: 80 }, (_, i) => H(`m${i}`, `Many ${i}`, "best", null, 1 + i / 100, { thumbnail: `https://i.ytimg.com/vi/m${i}/mqdefault.jpg` })) });
await nav(page, "History").click();
await waitCalls(page, "fetch_thumbnail", 1);
await page.waitForTimeout(600);
const early = (await calls(page, "fetch_thumbnail")).length;
check("thumbs: a long list doesn't fetch everything at once", early > 0 && early < 60, String(early));
check("thumbs: the last row's picture hasn't been fetched yet", !(await calls(page, "fetch_thumbnail")).some((c) => c.args.url.includes("/m79/")));
await page.locator("tr", { hasText: "Many 79" }).first().scrollIntoViewIfNeeded();
await page.waitForFunction(() => window.__mock.calls.some((c) => c.cmd === "fetch_thumbnail" && c.args.url.includes("/m79/")), null, { timeout: 15000 });
check("thumbs: scrolling to a row fetches its picture, and rows skipped over stay unfetched", (await calls(page, "fetch_thumbnail")).length < 80);
await page.context().close();

// ================= lyrics need consent =================
page = await open({ store: { mode: "advanced", warnDuplicates: false } });
await nav(page, "Settings").click();
const lyrics = page.getByLabel("Default lyrics");
await lyrics.selectOption("file");
await dialog(page).waitFor();
const body = await dialog(page).innerText();
check("lyrics: asks first, naming the service and what is sent", /LRCLIB/.test(body) && /artist and title/.test(body), body);
await dialog(page).getByRole("button", { name: "No lyrics" }).click();
let st = await settingsOf(page);
check("lyrics: 'no' leaves lyrics off and nothing agreed", st.lyricsMode === "off" && st.lyricsConsent === false && (await lyrics.inputValue()) === "off", JSON.stringify([st.lyricsMode, st.lyricsConsent]));
await lyrics.selectOption("file");
await dialog(page).getByRole("button", { name: "Allow lookup" }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).settings.lyricsConsent === true);
st = await settingsOf(page);
check("lyrics: 'allow' turns them on and remembers", st.lyricsMode === "file" && st.lyricsConsent === true);
await lyrics.selectOption("embed");
check("lyrics: it isn't asked again", (await dialog(page).count()) === 0 && (await settingsOf(page)).lyricsMode === "embed");
await page.context().close();

// lyrics already switched on before Kaisu asked
page = await open({ store: { mode: "advanced", lyricsMode: "both", warnDuplicates: false } });
await dialog(page).waitFor();
check("lyrics: an older 'on' is asked about once, at start-up", /LRCLIB/.test(await dialog(page).innerText()));
await dialog(page).getByRole("button", { name: "No lyrics" }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).settings.lyricsMode === "off");
check("lyrics: 'no' turns the old setting off", (await settingsOf(page)).lyricsConsent === false);
await page.context().close();

page = await open({ store: { mode: "advanced", lyricsMode: "both", warnDuplicates: false } });
await dialog(page).getByRole("button", { name: "Allow lookup" }).click();
await audioCard(page);
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
check("lyrics: with consent they are requested", (await lastReq(page)).extra.lyrics === "both");
await page.context().close();

// a download that asks for lyrics without consent never does
page = await open({ store: { mode: "advanced", lyricsMode: "off", warnDuplicates: false } });
await audioCard(page);
await details(page).getByLabel("Lyrics").selectOption("file");
await dialog(page).getByRole("button", { name: "No lyrics" }).click();
check("lyrics: declining on the card keeps this download without lyrics", (await details(page).getByLabel("Lyrics").inputValue()) === "off");
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
check("lyrics: …and nothing is requested", (await lastReq(page)).extra.lyrics === "off");
await page.context().close();

page = await open({ store: { mode: "advanced", lyricsConsent: true, warnDuplicates: false } });
await audioCard(page);
await details(page).getByLabel("Lyrics").selectOption("file");
check("lyrics: with consent the card doesn't ask", (await dialog(page).count()) === 0);
await details(page).getByRole("button", { name: "Download audio" }).click();
await waitCalls(page, "start_download", 1);
check("lyrics: …and the choice is sent", (await lastReq(page)).extra.lyrics === "file");
await page.context().close();

// ================= the proxy password stays out of the settings file =================
const SECRET_PROXY = "socks5://me:hunter2@127.0.0.1:1080";
const STRIPPED = "socks5://me@127.0.0.1:1080";
const secrets = (page) => page.evaluate(() => window.__mock.secrets ?? {});

page = await open({ store: { warnDuplicates: false } });
await nav(page, "Settings").click();
await page.getByLabel("Proxy", { exact: true }).fill(SECRET_PROXY);
await page.waitForFunction((p) => JSON.parse(localStorage.getItem("__store")).settings.proxy === p, STRIPPED);
check("proxy password: the settings file holds the address without it", !JSON.stringify(await page.evaluate(() => localStorage.getItem("__store"))).includes("hunter2"));
check("proxy password: it went to the credential store", (await secrets(page))["proxy-password"] === "hunter2");
await nav(page, "Search").click();
await submit(page, "lofi");
await results(page).waitFor();
check("proxy password: requests still use the full address", (await calls(page, "search_media")).at(-1).args.proxy === SECRET_PROXY);
await nav(page, "Settings").click();
await page.getByLabel("Proxy", { exact: true }).fill("socks5://127.0.0.1:1080");
await page.waitForFunction(() => window.__mock.secrets?.["proxy-password"] === undefined);
check("proxy password: removing it also removes the stored copy", (await secrets(page))["proxy-password"] === undefined);
await page.context().close();

page = await open({ store: { proxy: STRIPPED, warnDuplicates: false }, mock: { secrets: { "proxy-password": "hunter2" } } });
await submit(page, "lofi");
await results(page).waitFor();
check("proxy password: after a restart the stored password is put back", (await calls(page, "search_media")).at(-1).args.proxy === SECRET_PROXY);
await nav(page, "Settings").click();
check("proxy password: …and the box covers it until it is edited", (await page.locator("[data-proxy-cover]").innerText()) === "socks5://me:***@127.0.0.1:1080");
await page.getByLabel("Proxy", { exact: true }).focus();
check("proxy password: …then shows what was typed", (await page.locator("[data-proxy-cover]").count()) === 0 && (await page.getByLabel("Proxy", { exact: true }).inputValue()) === SECRET_PROXY);
await page.context().close();

page = await open({ store: { proxy: SECRET_PROXY, warnDuplicates: false } });
await page.waitForFunction((p) => JSON.parse(localStorage.getItem("__store")).settings.proxy === p, STRIPPED, { timeout: 8000 });
check("proxy password: one saved in the file by an older version is moved out", (await secrets(page))["proxy-password"] === "hunter2" && !JSON.stringify(await page.evaluate(() => localStorage.getItem("__store"))).includes("hunter2"));
await submit(page, "lofi");
await results(page).waitFor();
check("proxy password: …and still works", (await calls(page, "search_media")).at(-1).args.proxy === SECRET_PROXY);
await page.context().close();

page = await open({ store: { warnDuplicates: false }, mock: { noKeyring: true } });
await nav(page, "Settings").click();
await page.getByLabel("Proxy", { exact: true }).fill(SECRET_PROXY);
await page.waitForFunction((p) => JSON.parse(localStorage.getItem("__store")).settings.proxy === p, SECRET_PROXY);
await nav(page, "Search").click();
await submit(page, "lofi");
await results(page).waitFor();
check("proxy password: with no credential store it still works, kept as before", (await calls(page, "search_media")).at(-1).args.proxy === SECRET_PROXY);
await page.context().close();

// ================= the power countdown belongs to the backend =================
const downloadAndFinish = async (page, mode) => {
  await nav(page, "Downloads").click();
  await page.getByLabel("When downloads finish").selectOption(mode);
  await nav(page, "Search").click();
  await submit(page, url);
  await details(page).waitFor();
  await details(page).getByRole("button", { name: "Download video" }).click();
  await tick(page, 3);
};
page = await open({ clock: true, mock: { powerRefused: true } });
await downloadAndFinish(page, "shutdown");
await page.getByRole("status").filter({ hasText: "still running, so Kaisu won't turn the computer off" }).waitFor();
check("power: when the backend refuses, that is said and no countdown is shown", (await page.getByRole("alert").filter({ hasText: "shut the computer down" }).count()) === 0);
await tick(page, 40);
check("power: …and nothing fires", ((await page.evaluate(() => window.__mock.powerFired)) ?? []).length === 0);
await page.context().close();

await done();
