import { open, check, calls, waitCalls, nav, box, submit, details, done, fileAction } from "../harness.mjs";
const VIDEO = "https://www.youtube.com/watch?v=pasted00001";
const SOURCE = "https://www.youtube.com/playlist?list=PLsaved";
const store = async (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")));
const sourceNav = async (page) => { await nav(page, "Saved sources").click(); await page.getByRole("heading", { name: "Saved sources", exact: true }).waitFor(); };
const playlist = { id: "pl-target", name: "My music", paths: [], updated: 1 };

// Settings recovery and stale results/errors.
let page = await open({ store: { schedule: null, audioQuality: null, customArgs: null } });
check("settings: malformed fields do not blank the app", await box(page).isVisible());
await submit(page, "old query");
await waitCalls(page, "search_media", 1);
await submit(page, VIDEO);
await details(page).waitFor();
check("lookup: old search does not return after a new link", await page.getByText("old query — result 1", { exact: true }).count() === 0);
await submit(page, "https://example.com/private");
await waitCalls(page, "get_media_info", 2);
await submit(page, "https://example.com/a https://example.com/b");
await page.waitForTimeout(650);
check("lookup: private-link error cannot contaminate a new batch", await page.getByText(/Sign in to confirm your age/).count() === 0);
await page.context().close();

// Choose an existing playlist; only verified successful audio becomes a member.
page = await open({ store: { warnDuplicates: false }, data: { playlists: [playlist] }, mock: { manualDownloads: true } });
await submit(page, VIDEO); await details(page).waitFor();
await page.getByRole("button", { name: "Choose a library playlist…" }).click();
await page.getByRole("button", { name: "Add to My music", exact: true }).click();
await details(page).getByRole("radio", { name: /Audio only/ }).click();
await details(page).getByRole("button", { name: "Download audio", exact: true }).click();
await waitCalls(page, "start_download", 1);
const req = (await calls(page, "start_download"))[0].args.req;
check("playlist: target travels with the native request", req.extra.library_playlist_ids?.[0] === playlist.id);
check("playlist: unfinished downloads are not added", (await store(page)).playlists[0].paths.length === 0);
await nav(page, "Library").click();
await page.getByLabel("Library view", { exact: true }).selectOption("playlists");
check("playlist: waiting count is visible", (await page.getByRole("button", { name: "Open My music", exact: true }).innerText()).includes("1 waiting for download"));
await page.evaluate((id) => { const c = window.__mock.downloadControls[id]; c.send({ kind: "done", path: "/home/u/Downloads/New song.mp3" }); c.resolve(); }, req.id);
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).playlists[0].paths.includes("/home/u/Downloads/New song.mp3"));
check("playlist: verified completion is saved into the playlist", true);
await page.reload(); await box(page).waitFor();
check("playlist: membership survives restart", (await store(page)).playlists[0].paths.includes("/home/u/Downloads/New song.mp3"));
await page.context().close();

// Create a playlist from the download target chooser and restore a queued target.
page = await open(); await submit(page, VIDEO); await details(page).waitFor();
await page.getByRole("button", { name: "Choose a library playlist…" }).click();
await page.getByLabel("New playlist name").fill("Downloaded favorites");
await page.getByRole("button", { name: "Create and add", exact: true }).click();
check("playlist: a new destination can be created before downloading", (await store(page)).playlists.some((p) => p.name === "Downloaded favorites"));
await page.context().close();

// Sources are checked manually, persist their review list and profile, and retain failed submissions.
page = await open({ data: { playlists: [playlist] }, store: { warnDuplicates: false } });
await sourceNav(page);
await page.getByLabel("Channel or playlist link").fill(SOURCE);
await page.getByRole("button", { name: "Save source", exact: true }).click();
await page.getByRole("article", { name: "Road Trip: Mix / 2026", exact: true }).waitFor();
let card = page.getByRole("article", { name: "Road Trip: Mix / 2026", exact: true });
check("sources: saving does not start downloads", (await calls(page, "start_download")).length === 0);
check("sources: initial items are available for review", (await store(page)).savedSources[0].pending.length === 7);
await card.getByLabel("Download format for Road Trip: Mix / 2026").selectOption("audio");
await card.getByLabel("Audio format for Road Trip: Mix / 2026").selectOption("opus");
await card.getByRole("button", { name: "Choose a library playlist…" }).click();
await page.getByRole("button", { name: "Add to My music", exact: true }).click();
await card.getByRole("button", { name: "Mark all reviewed", exact: true }).click();
await page.reload(); await box(page).waitFor(); await sourceNav(page);
card = page.getByRole("article", { name: "Road Trip: Mix / 2026", exact: true });
check("sources: saved profile and review state survive restart", (await store(page)).savedSources[0].audioFormat === "opus" && (await store(page)).savedSources[0].pending.length === 0);
await page.evaluate(() => { window.__mock.playlistTotal = 8; });
await card.getByRole("button", { name: "Check for new items", exact: true }).click();
await card.getByLabel("Select Playlist video 8", { exact: true }).waitFor();
check("sources: only a newly discovered item needs review", (await store(page)).savedSources[0].pending.length === 1);
await page.setViewportSize({ width: 720, height: 576 });
for (const theme of ["aqua", "graphite", "dark"]) {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  check(`sources: ${theme} fits the minimum window width`, await page.locator(".app").evaluate((el) => el.scrollWidth <= innerWidth));
}
await page.screenshot({ path: "src-tauri/target/saved-sources-small.png" });
await page.setViewportSize({ width: 1060, height: 800 });
await page.evaluate(() => { window.__mock.playlistFail = true; });
await card.getByRole("button", { name: "Check for new items", exact: true }).click();
await card.getByRole("alert").waitFor();
check("sources: a check failure retains the review list", (await store(page)).savedSources[0].pending.length === 1);
await page.evaluate(() => { window.__mock.playlistFail = false; window.__mock.folderProblem = "Destination unavailable"; });
await card.getByLabel("Select Playlist video 8", { exact: true }).check();
await card.getByRole("button", { name: "Download selected (1)", exact: true }).click();
await page.waitForTimeout(400);
check("sources: failed queue preflight keeps items for another attempt", (await store(page)).savedSources[0].pending.length === 1);
await page.evaluate(() => { window.__mock.folderProblem = null; });
if ((await store(page)).savedSources[0].pending.length) await card.getByRole("button", { name: "Download selected (1)", exact: true }).click();
await waitCalls(page, "start_download", 1);
const sourceReq = (await calls(page, "start_download"))[0].args.req;
check("sources: reviewed selections use the saved audio profile", sourceReq.preset === "audio" && sourceReq.extra.audio_format === "opus" && sourceReq.extra.library_playlist_ids?.[0] === playlist.id);
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).savedSources[0].pending.length === 0);
check("sources: accepted queue items leave the review list", true);
await card.getByRole("button", { name: "Check for new items", exact: true }).click(); await page.waitForTimeout(400);
check("sources: downloading does not make an item reappear on later checks", (await store(page)).savedSources[0].pending.length === 0);
await page.context().close();

// Save failures remain visible until retry succeeds, and an opener failure does not imply missing media.
const history = [{ id: "h1", title: "Existing video", url: VIDEO, thumbnail: "", preset: "best", path: "/home/u/Downloads/Existing.mp4", timestamp: Date.now() }];
page = await open({ history, mock: { openerFail: true } });
await nav(page, "History").click();
let row = page.locator("tr", { hasText: "Existing video" }).first();
await row.getByRole("button", { name: "Open file", exact: true }).click();
await page.waitForTimeout(250);
check("files: failed launch keeps existing media available", await row.getByRole("button", { name: "Open file", exact: true }).isEnabled());
await page.evaluate(() => { window.__mock.storeSaveFail = true; });
await nav(page, "Settings").click();
await page.getByLabel("Settings section", { exact: true }).selectOption("Customization"); await page.getByLabel("Theme", { exact: true }).selectOption("dark");
await page.getByRole("alert", { name: "Storage problem", exact: true }).waitFor();
check("storage: disk-save errors have an actionable persistent notice", true);
await page.evaluate(() => { window.__mock.storeSaveFail = false; });
await page.getByRole("button", { name: "Retry saving or loading", exact: true }).click();
await page.getByRole("alert", { name: "Storage problem", exact: true }).waitFor({ state: "detached" });
check("storage: retry clears the notice only after saving", true);
await page.context().close();

// Both queue restoration and independent native recovery retain playlist destinations through retries.
for (const recovery of [false, true]) {
  const original = { id: "playlist-recovery", title: "Recovered song", url: VIDEO, thumbnail: "", preset: "audio", outDir: "/home/u/Downloads", extra: req.extra, status: "paused", progress: 25 };
  page = await open({ data: { playlists: [playlist] }, queue: recovery ? [] : [original], mock: { manualDownloads: true, ...(recovery ? { downloadRecovery: [{ id: original.id, request: { id: original.id, url: VIDEO, out_dir: original.outDir, preset: "audio", extra: req.extra }, expected_path: null, resolved_format: null, updated: 1 }] } : {}) } });
  if (recovery) await page.getByRole("button", { name: "Recover original downloads", exact: true }).click();
  await nav(page, "Downloads").click();
  if (!recovery) await page.getByRole("button", { name: "Resume download", exact: true }).click();
  await waitCalls(page, "start_download", 1);
  let request = (await calls(page, "start_download")).at(-1).args.req;
  check(`${recovery ? "recovery" : "restore"}: playlist destination survives`, request.extra.library_playlist_ids?.[0] === playlist.id);
  await page.evaluate((id) => { const control = window.__mock.downloadControls[id]; control.send({ kind: "cancelled" }); control.resolve(); }, request.id);
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  check("playlist: cancellation does not add a nonexistent file", (await store(page)).playlists[0].paths.length === 0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await waitCalls(page, "start_download", 2);
  request = (await calls(page, "start_download")).at(-1).args.req;
  await page.evaluate((id) => { const control = window.__mock.downloadControls[id]; control.send({ kind: "error", message: "Output verification failed" }); control.resolve(); }, request.id);
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  check("playlist: verification failure does not add a file", (await store(page)).playlists[0].paths.length === 0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await waitCalls(page, "start_download", 3);
  request = (await calls(page, "start_download")).at(-1).args.req;
  await page.evaluate((id) => { const control = window.__mock.downloadControls[id]; control.send({ kind: "done", path: "/home/u/Downloads/Recovered.mp3" }); control.resolve(); }, request.id);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).playlists[0].paths.includes("/home/u/Downloads/Recovered.mp3"));
  check("playlist: retry commits a verified file exactly once", (await store(page)).playlists[0].paths.length === 1);
  await page.context().close();
}

page = await open({ data: { playlists: [playlist] }, mock: { storeReadFail: ["playlists"] } });
await page.getByRole("alert", { name: "Storage problem", exact: true }).waitFor();
await submit(page, VIDEO); await details(page).waitFor();
await page.getByRole("button", { name: "Choose a library playlist…" }).click();
await page.getByLabel("New playlist name").fill("Unsaved replacement");
await page.getByRole("button", { name: "Create and add", exact: true }).click();
await page.waitForTimeout(200);
check("storage: failed reads prevent overwriting the original collection", (await store(page)).playlists[0].name === "My music");
await page.context().close();

// A second completion arriving during the first playlist save must also drain.
page = await open({ data: { playlists: [playlist] }, mock: { manualDownloads: true }, store: { warnDuplicates: false } });
await submit(page, "batch music");
await page.getByRole("checkbox", { name: "Select batch music — result 1", exact: true }).waitFor();
await page.getByRole("button", { name: "Choose a library playlist…" }).click();
await page.getByRole("button", { name: "Add to My music", exact: true }).click();
await page.getByRole("checkbox", { name: "Select batch music — result 1", exact: true }).check();
await page.getByRole("checkbox", { name: "Select batch music — result 2", exact: true }).check();
await page.getByRole("button", { name: "Download 2 audio (MP3)", exact: true }).click();
await waitCalls(page, "start_download", 2);
const batch = (await calls(page, "start_download")).map((c) => c.args.req.id);
await page.evaluate(() => { window.__mock.storeSaveDelay = 100; });
await page.evaluate((id) => { const control = window.__mock.downloadControls[id]; control.send({ kind: "done", path: "/home/u/Downloads/Batch1.mp3" }); control.resolve(); }, batch[0]);
await page.waitForTimeout(30);
await page.evaluate((id) => { const control = window.__mock.downloadControls[id]; control.send({ kind: "done", path: "/home/u/Downloads/Batch2.mp3" }); control.resolve(); }, batch[1]);
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).playlists[0].paths.length === 2);
check("playlist: concurrent completions drain through a slow save", true);
await page.context().close();

page = await open({ queue: [{ id: "exit-queue", title: "Waiting audio", url: VIDEO, thumbnail: "", preset: "audio", outDir: "/home/u/Downloads", extra: req.extra, status: "paused", progress: 25 }] });
await page.waitForFunction(() => !!window.__events?.["prepare-exit"]);
await page.evaluate(() => { window.__mock.storeSaveFail = true; window.__events["prepare-exit"]({ payload: null }); });
await waitCalls(page, "finish_exit", 1);
check("exit: a failed flush cancels the native exit request", (await calls(page, "finish_exit"))[0].args.saved === false);
await page.evaluate(() => { window.__mock.storeSaveFail = false; window.__events["prepare-exit"]({ payload: null }); });
await waitCalls(page, "finish_exit", 2);
check("exit: successful flush acknowledges exit", (await calls(page, "finish_exit")).at(-1).args.saved === true);
check("exit: queue snapshots exclude transient logs", (await store(page)).queue.length === 1 && !("log" in (await store(page)).queue[0]));
await page.context().close();

await done();
