// App update notice, password-store status, original audio, lossless-format note, download plan and library health.
import { open, check, calls, nav, submit, details, chooseMenu, done } from "../harness.mjs";
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings);
const section = (p, name) => p.getByLabel("Settings section", { exact: true }).selectOption(name);
const track = (over) => ({ path: "/home/u/Music/a.mp3", title: "Song", artist: "Band", album_artist: "", album: "Album", track: null, disc: null, year: 2024, genre: "Rock", duration: 200, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1, added: 1, has_cover: true, loudness: null, ...over });

// ---- update notice ----
let page = await open({ mock: { appLatest: "0.0.5" } });
await page.getByRole("status", { name: "Kaisu update available" }).waitFor();
check("update: a newer release is announced once the check runs", (await page.getByRole("status", { name: "Kaisu update available" }).innerText()).includes("Kaisu 0.0.5 is available"));
check("update: the check is recorded so it only runs daily", (await saved(page)).appUpdateLastCheck > 0);
await page.getByRole("button", { name: "See what's new", exact: true }).click();
check("update: the notice opens the fixed releases page", (await calls(page, "open_url")).at(-1)?.args.url === "https://github.com/mirimomekiku/kaisu/releases");
await page.getByRole("button", { name: "Dismiss this update notice", exact: true }).click();
check("update: dismissing remembers that release", await page.getByRole("status", { name: "Kaisu update available" }).count() === 0 && (await saved(page)).appUpdateDismissed === "0.0.5");
await page.context().close();

page = await open({ mock: { appLatest: "0.0.5" }, store: { appUpdateDismissed: "0.0.5", appUpdateLastCheck: 0 } });
await page.waitForFunction(() => window.__mock.appUpdateChecks >= 1);
await page.waitForTimeout(200);
check("update: a dismissed release is not announced again", await page.getByRole("status", { name: "Kaisu update available" }).count() === 0);
await nav(page, "Settings").click(); await section(page, "All settings");
await page.getByRole("button", { name: "Check Kaisu for updates", exact: true }).click();
await page.getByText("Kaisu 0.0.5 is available (you have 0.0.4).", { exact: true }).waitFor();
check("update: checking by hand shows it even when dismissed", await page.getByRole("button", { name: "Open releases page", exact: true }).count() === 1);
await page.context().close();

page = await open({ mock: { appLatest: "0.0.9" }, store: { appUpdateChecks: false } });
await page.waitForTimeout(300);
check("update: switched off means no background request", await page.evaluate(() => (window.__mock.appUpdateChecks ?? 0) === 0));
await page.context().close();

page = await open({ mock: { appUpdateFail: true }, store: { appUpdateLastCheck: 0 } });
await page.waitForTimeout(300);
check("update: a failed background check is silent", await page.getByRole("status", { name: "Kaisu update available" }).count() === 0 && await page.getByRole("alert").count() === 0);
await nav(page, "Settings").click(); await section(page, "All settings");
await page.getByRole("button", { name: "Check Kaisu for updates", exact: true }).click();
await page.getByText("Couldn't reach GitHub.", { exact: true }).waitFor();
check("update: a failed manual check says why", true);
await page.context().close();

// ---- password store status ----
page = await open({});
await nav(page, "Settings").click(); await section(page, "All settings");
await page.getByRole("status", { name: "Password store status" }).waitFor();
check("password store: says where passwords are kept", (await page.getByRole("status", { name: "Password store status" }).innerText()).includes("Secret Service"));
await page.context().close();
page = await open({ mock: { noKeyring: true } });
await nav(page, "Settings").click(); await section(page, "All settings");
await page.getByRole("alert", { name: "Password store status" }).waitFor();
check("password store: warns about the fallback when there is none", (await page.getByRole("alert", { name: "Password store status" }).innerText()).includes("stays in Kaisu's settings file"));
await page.context().close();

// ---- audio formats ----
page = await open({ store: { mode: "advanced" } });
await nav(page, "Settings").click(); await section(page, "All settings");
await page.getByLabel("Audio format", { exact: true }).selectOption("flac");
check("audio: FLAC says it cannot restore lost quality", (await page.getByRole("note").filter({ hasText: "does not restore quality" }).count()) >= 1);
await page.getByLabel("Audio format", { exact: true }).selectOption("original");
check("audio: original audio is saved and explains what it skips", (await saved(page)).audioFormat === "original" && await page.getByRole("note").filter({ hasText: "kept as it is" }).count() === 1);
await page.getByLabel("Audio format", { exact: true }).selectOption("mp3");
check("audio: converted formats show no note", await page.getByRole("note").filter({ hasText: "does not restore quality" }).count() === 0);
await page.getByLabel("Audio format", { exact: true }).selectOption("original");
await nav(page, "Search").click();
await submit(page, "https://www.youtube.com/watch?v=orig0000001");
await details(page).waitFor();
check("plan: the card says how the file will be saved", (await details(page).getByLabel("What will happen to this download").innerText()).includes("Saved as: All in one folder"));
await details(page).getByRole("button", { name: /Audio only|Audio/ }).first().click().catch(() => {});
await page.context().close();

page = await open({ store: { mode: "advanced", audioFormat: "original", audioNormalize: true, siteRules: [{ id: "r1", host: "youtube.com", channel: "", preset: "audio", audioFormat: "flac", folder: "/home/u/Rules" }] } });
await submit(page, "https://www.youtube.com/watch?v=orig0000002");
await details(page).waitFor();
const plan = await details(page).getByLabel("What will happen to this download").innerText();
check("plan: a matching site rule is named before downloading", plan.includes("Site rule:") && plan.includes("youtube.com") && plan.includes("FLAC") && plan.includes("/home/u/Rules"));
await page.context().close();

// ---- library health ----
const broken = track({ path: "/home/u/Music/broken.mp3", title: "broken", artist: "", album: "", duration: 0, sample_rate: null, channels: null, bitrate: null });
const gone = track({ path: "/home/u/Music/gone.mp3", title: "Gone", missing: true });
const untagged = track({ path: "/home/u/Music/untagged.mp3", title: "untagged", artist: "" });
page = await open({ mock: { library: [track(), broken, gone, untagged] } });
await nav(page, "Library").click(); await chooseMenu(page, "Library tools", "Library cleanup");
const sheet = page.getByRole("dialog", { name: "Library cleanup", exact: true });
await sheet.waitFor();
check("health: one summary says how many files need attention", (await sheet.getByRole("status", { name: "Library health" }).innerText()).includes("3 files need attention"));
const summary = await sheet.locator(".cleanup-summary").innerText();
check("health: counts missing, unreadable and incomplete files", summary.includes("1 missing files") && summary.includes("1 unreadable files") && summary.includes("1 with incomplete metadata"), JSON.stringify(summary));
await sheet.getByRole("button", { name: /unreadable files/ }).click();
check("health: the unreadable view lists the broken file without edit actions", await sheet.locator(".cleanup-row").count() === 1 && (await sheet.locator(".cleanup-row").innerText()).includes("broken.mp3") && await sheet.getByRole("button", { name: "Edit tags", exact: true }).count() === 0);
check("health: reviewing changes no files", (await calls(page, "delete_files")).length === 0 && (await calls(page, "library_forget_missing")).length === 0);
await page.context().close();
await done();
