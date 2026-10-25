// Imported collections, smart playlists, exact duplicate review, and mini-player.
import { libraryFilter, chooseMenu, open, check, calls, waitCalls, nav, done } from "../harness.mjs";
const root = "/home/u/Music";
const t = (title, extra = {}) => ({ path: `${root}/${title}.mp3`, title, artist: "Band", album_artist: "", album: "Album", genre: "Rock", year: 2020, track: null, disc: null, duration: 180, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1000, added: Math.floor(Date.now()/1000), has_cover: false, loudness: -18, ...extra });
const A = t("Alpha"), B = t("Beta"), M = t("Missing", { missing: true });
const lib = (p) => p.getByRole("region", { name: "Music library" });
const dlg = (p) => p.getByRole("dialog");
const seed = async (p, values) => { await p.evaluate((v) => localStorage.setItem("__store", JSON.stringify({ ...JSON.parse(localStorage.getItem("__store")), ...v })), values); await p.reload(); };
const scan = async (p) => { await chooseMenu(p, "Library tools", "Rescan"); await p.waitForFunction(() => !window.__mock.scanning); await p.waitForTimeout(100); };
let page = await open({ mock: { library: [A, M], musicFolders: [{ path: root, available: true }], importFolder: "/archive", importTracks: [t("Imported", { path: "/archive/Imported.mp3" })], relocations: { [M.path]: t("Located") } } });
await seed(page, {
  playlists: [{ id: "manual", name: "Recovered", paths: [M.path], updated: 1 }],
  listening: { [M.path]: { plays: 3, lastPlayed: 100 } },
  musicPreferences: { [M.path]: { favorite: true, rating: 4 } },
  history: [{ id: "m", url: "https://example.com/song.mp3", title: "Missing", thumbnail: "", preset: "audio", path: M.path, timestamp: Date.now() }],
});
await nav(page, "Library").click();
await lib(page).getByRole("button", { name: "Play Alpha", exact: true }).waitFor();
check("folders: missing files hidden by default and count shown", await lib(page).getByRole("button", { name: "Play Missing", exact: true }).count() === 0 && (await lib(page).innerText()).includes("1 missing"));
await chooseMenu(page, "Library tools", "Music folders");
await dlg(page).getByRole("button", { name: "Add music folder" }).click();
await dlg(page).getByRole("button", { name: "Remove folder /archive", exact: true }).waitFor();
check("folders: native folder import command used", (await calls(page, "library_add_folder")).length === 1);
await dlg(page).getByLabel("Watch music folders for changes").uncheck();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).libraryWatch === false);
check("watch: pause persisted", true);
await dlg(page).getByRole("button", { name: "Done", exact: true }).click();
await lib(page).getByRole("button", { name: "Play Imported", exact: true }).waitFor();
check("folders: existing music appears without downloading", (await calls(page, "start_download")).length === 0);
await libraryFilter(page, "File availability", "missing");
await lib(page).getByRole("button", { name: "Locate Missing", exact: true }).waitFor();
check("missing: missing file cannot play", await lib(page).getByRole("button", { name: "Play Missing", exact: true }).isDisabled());
await page.getByLabel("Library view", { exact: true }).selectOption("albums");
await lib(page).getByRole("button", { name: "Open Album by Band", exact: true }).click();
check("missing: album actions cannot play or edit unavailable files", await lib(page).getByRole("button", { name: "Play Missing", exact: true }).isDisabled() && await lib(page).getByRole("button", { name: "Edit album", exact: true }).isDisabled());
await page.getByLabel("Library view", { exact: true }).selectOption("songs");

await lib(page).getByRole("button", { name: "Locate Missing", exact: true }).click();
await libraryFilter(page, "File availability", "available");
await lib(page).getByRole("button", { name: "Play Located", exact: true }).waitFor();
check("locate: favorites and ratings follow moved files", await lib(page).getByRole("button", { name: "Unfavorite Located", exact: true }).count() === 1 && await lib(page).getByLabel("Rating for Located").inputValue() === "4");
check("locate: replacement entry is available", (await calls(page, "library_locate"))[0].args.path === M.path);
await page.waitForFunction((path) => { const st = JSON.parse(localStorage.getItem("__store")); return st.playlists[0].paths[0] === path && st.listening[path]?.plays === 3 && st.history[0].path === path; }, t("Located").path);
check("locate: playlists, listening counts and history follow the moved file", !(await page.evaluate((path) => JSON.parse(localStorage.getItem("__store")).listening[path], M.path)));

await chooseMenu(page, "Library tools", "Music folders");
await dlg(page).getByRole("button", { name: "Remove folder /archive", exact: true }).click();
await dlg(page).getByRole("button", { name: "Remove folder /archive", exact: true }).waitFor({ state: "detached" });
check("folders: removing a root does not delete music", (await calls(page, "delete_files")).length === 0 && (await calls(page, "library_remove_duplicates")).length === 0);
await dlg(page).getByRole("button", { name: "Done", exact: true }).click();
await lib(page).getByRole("button", { name: "Play Imported", exact: true }).waitFor({ state: "detached" });
await page.reload(); await nav(page, "Library").click();
await chooseMenu(page, "Library tools", "Music folders");
check("watch: paused preference survives restart", !(await dlg(page).getByLabel("Watch music folders for changes").isChecked()));
await page.evaluate(() => window.__mock.importFolder = null);
await dlg(page).getByRole("button", { name: "Add music folder", exact: true }).click();
await dlg(page).getByRole("button", { name: "Add music folder", exact: true }).waitFor();
check("folders: cancelling native chooser leaves imported roots unchanged", await dlg(page).getByRole("button", { name: /^Remove folder/ }).count() === 1);

await page.context().close();

// A watcher detects external changes; pausing it stops periodic scans.
page = await open({ clock: true, mock: { library: [A] } });
await nav(page, "Library").click();
await lib(page).getByRole("button", { name: "Play Alpha", exact: true }).waitFor();
await page.evaluate((b) => window.__mock.library.push(b), B);
await page.clock.fastForward(300100); await page.clock.runFor(300);
await lib(page).getByRole("button", { name: "Play Beta", exact: true }).waitFor();
check("watch: external additions appear", true);
await page.evaluate(() => { window.__mock.library[0].missing = true; });
await page.clock.fastForward(300100); await page.clock.runFor(300);
await lib(page).getByRole("button", { name: "Play Alpha", exact: true }).waitFor({ state: "detached" });
check("watch: external removals become missing entries", (await lib(page).innerText()).includes("1 missing"));
await chooseMenu(page, "Library tools", "Music folders");
await dlg(page).getByLabel("Watch music folders for changes").uncheck();
const before = (await calls(page, "library_scan")).length;
await page.clock.fastForward(600100);
check("watch: paused watcher stops periodic scans", (await calls(page, "library_scan")).length === before);
await page.context().close();

// Smart rules persist and re-evaluate after a metadata change.
page = await open({ mock: { library: [A, B, M] } });
await nav(page, "Library").click();
await page.getByLabel("Library view", { exact: true }).selectOption("playlists");
await lib(page).getByRole("button", { name: "New smart playlist", exact: true }).click();
await dlg(page).getByLabel("Playlist name").fill("Band favorites");
await dlg(page).getByLabel("Rule 1 value").fill("Band");
await dlg(page).getByRole("button", { name: "Save smart playlist" }).click();
await lib(page).getByRole("button", { name: "Edit rules", exact: true }).waitFor();
check("smart: rule matches available songs only", await lib(page).locator(".album-tracks > li").count() === 2);
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).playlists?.[0]?.smart?.rules[0].value === "Band");
check("smart: saves rules rather than a fixed song list", (await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).playlists[0].paths.length)) === 0);
await page.evaluate(() => window.__mock.library[1].artist = "Other");
await scan(page);
check("smart: membership updates after tags change", await lib(page).locator(".album-tracks > li").count() === 1);
await lib(page).getByRole("button", { name: "Export .m3u8", exact: true }).click();
await page.waitForFunction(() => window.__mock.exports?.length === 1);
const snapshot = await page.evaluate(() => window.__mock.exports[0].contents);
check("smart: export snapshots current matches", snapshot.includes(A.path) && !snapshot.includes(B.path) && !snapshot.includes(M.path));

await lib(page).getByRole("button", { name: "Edit rules", exact: true }).click();
await dlg(page).getByLabel("Rule 1 field").selectOption("played");
await dlg(page).getByRole("button", { name: "Save smart playlist" }).click();
check("smart: rules can be edited to never played", await lib(page).locator(".album-tracks > li").count() === 2);
await page.reload(); await nav(page, "Library").click();
await page.getByLabel("Library view", { exact: true }).selectOption("playlists");
await lib(page).getByRole("button", { name: "Open Band favorites", exact: true }).click();
check("smart: playlist and rules survive restart", await lib(page).locator(".album-tracks > li").count() === 2);
await page.context().close();

// Completion updates listening history and removes a song from an unplayed playlist.
page = await open({ mock: { library: [A], audioSeconds: 1 } });
await seed(page, { playlists: [{ id: "auto", name: "Unplayed", paths: [], updated: 1, smart: { match: "all", rules: [{ field: "played", op: "is", value: "never" }] } }] });
await nav(page, "Library").click(); await page.getByLabel("Library view", { exact: true }).selectOption("playlists");
await lib(page).getByRole("button", { name: "Open Unplayed", exact: true }).click();
await lib(page).getByRole("button", { name: "Play Alpha", exact: true }).click();
await page.waitForFunction((path) => JSON.parse(localStorage.getItem("__store")).listening?.[path]?.plays === 1, A.path);
check("smart: completion removes a song from never played", await lib(page).locator(".album-tracks > li").count() === 0);
await page.context().close();

// Duplicate selection starts empty and deletion requires a separate review.
page = await open({ mock: { library: [A, B], duplicateGroups: [{ hash: "abc", size: 1000, paths: [A.path, B.path] }] } });
await nav(page, "Library").click(); await chooseMenu(page, "Library tools", "Find duplicates");
await dlg(page).getByLabel(`Keep ${A.path}`, { exact: true }).waitFor();
check("duplicates: nothing is preselected for removal", !(await dlg(page).getByLabel(`Remove ${B.path}`, { exact: true }).isChecked()) && await dlg(page).getByLabel(`Remove ${A.path}`, { exact: true }).isDisabled());
await dlg(page).getByLabel(`Remove ${B.path}`, { exact: true }).check();
await dlg(page).getByRole("button", { name: "Review removal (1)", exact: true }).click();
check("duplicates: review does not delete", (await calls(page, "library_remove_duplicates")).length === 0 && (await dlg(page).getByRole("region", { name: "Review duplicate removal" }).innerText()).includes(A.path));
await page.evaluate(() => window.__mock.duplicateFail = true);
await dlg(page).getByRole("button", { name: "Recycle selected copies", exact: true }).click();
await dlg(page).getByRole("alert").waitFor();
check("duplicates: changed files show an error and remain listed", await dlg(page).locator(".duplicate-file").count() === 2);
await page.evaluate(() => window.__mock.duplicateFail = false);
await dlg(page).getByRole("button", { name: "Recycle selected copies", exact: true }).click();
await dlg(page).getByText("No exact duplicates found.", { exact: true }).waitFor();
const removal = (await calls(page, "library_remove_duplicates")).at(-1).args;
check("duplicates: only selected copies are requested and keeper/hash included", removal.keep === A.path && removal.hash === "abc" && JSON.stringify(removal.paths) === JSON.stringify([B.path]));
await dlg(page).getByRole("button", { name: "Done", exact: true }).click();
await lib(page).getByRole("button", { name: "Play Beta", exact: true }).waitFor({ state: "detached" });
check("duplicates: library refreshes after removal", await lib(page).getByRole("button", { name: "Play Alpha", exact: true }).count() === 1);
await page.context().close();

// One audio instance and the existing queue survive both directions of the mini switch.
page = await open({ mock: { library: [A, B], audioSeconds: 90 } });
await page.evaluate(() => { window.__plays = 0; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function() { window.__plays++; return play.call(this); }; });
await nav(page, "Library").click(); await lib(page).getByRole("button", { name: "Play Alpha", exact: true }).click();
const bar = () => page.getByRole("region", { name: "Music player", exact: true });
await bar().getByRole("button", { name: "Pause", exact: true }).waitFor();
await bar().getByRole("button", { name: "Playback options", exact: true }).click();
await page.getByRole("dialog", { name: "Playback options", exact: true }).getByRole("button", { name: "Open mini-player", exact: true }).click();
const mini = () => page.getByRole("region", { name: "Mini-player", exact: true });
await mini().waitFor(); await page.setViewportSize({ width: 480, height: 210 });
check("mini: switching does not restart playback", await page.evaluate(() => window.__plays) === 1 && (await calls(page, "set_mini_mode"))[0].args.mini === true);
await mini().getByRole("button", { name: "Pause", exact: true }).click();
await mini().getByRole("button", { name: "Play", exact: true }).waitFor();
await mini().getByRole("button", { name: "Next track", exact: true }).click();
await mini().getByText("Beta", { exact: true }).waitFor();
check("mini: queue controls work", true);
await page.screenshot({ path: "src-tauri/target/mini-player.png" });
check("mini: controls fit compact window", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
await page.setViewportSize({ width: 420, height: 180 });
check("mini: controls fit the minimum size", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));

await page.evaluate(() => window.__mock.miniFail = true);
await mini().getByRole("button", { name: "Return to full window", exact: true }).click();
await mini().getByRole("alert").waitFor();
check("mini: restore errors keep a usable mini-player", await mini().getByRole("button", { name: "Return to full window", exact: true }).isEnabled());
await page.evaluate(() => window.__mock.miniFail = false);
await mini().getByRole("button", { name: "Return to full window", exact: true }).click();
await page.setViewportSize({ width: 1060, height: 800 });
await bar().waitFor();
check("mini: restore retains the current song and queue", (await bar().innerText()).includes("Beta") && (await calls(page, "set_mini_mode")).at(-1).args.mini === false);
await page.context().close();
await done();
