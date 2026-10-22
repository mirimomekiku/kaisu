// Audit regressions: queue credentials, automatic relocation and site-rule roots.
import { chooseMenu, open, check, calls, waitCalls, nav, done } from "../harness.mjs";

const DL = "/home/u/Downloads", USB = "/mnt/usb/Kaisu", RULE = "/mnt/music/Site";
const source = `${DL}/Alpha.mp3`, target = `${USB}/Alpha.mp3`;
const song = { path: source, title: "Alpha", artist: "Band", album_artist: "", album: "Album", genre: "Rock", year: 2020, track: null, disc: null, duration: 900, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1000, added: 123, has_cover: false, loudness: -18 };
const history = [{ id: "a", title: "Alpha", url: "https://example.com/alpha", thumbnail: "", preset: "audio", path: source, timestamp: Date.now() }];
const data = {
  musicPreferences: { [source]: { favorite: true, rating: 5 } },
  playlists: [{ id: "p", name: "My songs", paths: [source], updated: 1 }],
  listening: { [source]: { plays: 3, lastPlayed: 100, seconds: 42 } },
  positions: { [source]: { t: 90, d: 900, at: 100 } },
  player: { queue: [{ path: source, title: "Alpha", artist: "Band", duration: 900 }], index: 0, position: 90, volume: 1, rate: 1, repeat: "off", shuffle: false },
};
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")));
const lib = (page) => page.getByRole("region", { name: "Music library", exact: true });

let page = await open({ history, data, mock: { library: [song], storeDelays: { playlists: 2200, musicPreferences: 2000, listening: 1800, player: 2100, positions: 2300 } }, store: { moveEnabled: true, moveDir: USB } });
await page.waitForFunction((path) => JSON.parse(localStorage.getItem("__store")).history[0].path === path, target);
let state = await saved(page);
check("automatic move: runs while Library has never been opened", await page.getByRole("main", { name: "search" }).count() === 1);
check("automatic move: favorites and ratings follow", !state.musicPreferences[source] && state.musicPreferences[target]?.favorite && state.musicPreferences[target]?.rating === 5);
check("automatic move: manual playlists follow", state.playlists[0].paths.join() === target);
check("automatic move: listening totals follow once", !state.listening[source] && state.listening[target]?.plays === 3 && state.listening[target]?.seconds === 42);
check("automatic move: player queue and resume positions follow", state.player.queue[0].path === target && !state.positions[source] && state.positions[target]?.t === 90);
check("automatic move: cache metadata follows", await page.evaluate((path) => window.__mock.library[0].path === path && window.__mock.library[0].added === 123, target));
// The real backend retains its cache across a restart; reproduce that independently of frontend storage.
await page.addInitScript((track) => { window.__mock.library = [track]; }, { ...song, path: target });
await page.reload();
await nav(page, "Library").click();
await lib(page).getByRole("button", { name: "Unfavorite Alpha", exact: true }).waitFor();
state = await saved(page);
check("automatic move: state survives restart without double-counting", state.listening[target].plays === 3 && state.playlists[0].paths[0] === target && state.musicPreferences[target].rating === 5);
await page.context().close();

for (const options of [{ moveMode: "copy" }, { transferFail: [source] }]) {
  const copy = options.moveMode === "copy";
  page = await open({ history, data, mock: { library: [song], ...(copy ? {} : options) }, store: { moveEnabled: true, moveDir: USB, moveMode: copy ? "copy" : "move" } });
  await waitCalls(page, "transfer_files", 1); await page.waitForTimeout(400);
  state = await saved(page);
  check(copy ? "copy: original music identity is retained" : "failed move: all original records are retained", state.history[0].path === source && state.playlists[0].paths[0] === source && state.musicPreferences[source].favorite && state.listening[source].plays === 3 && state.player.queue[0].path === source);
  await page.context().close();
}

const extra = { proxy: "socks5://old:legacy-secret@old:1080", sponsorblock: "off", cookies_from_browser: null, subs: null, audio_format: "mp3", format_id: null, rate_limit: null, custom_args: null, verbose: false, output: { layout: "flat", name: "title_id", custom: null, playlist_folder: true, playlist_numbering: true }, playlist: null, clip: null };
page = await open({ store: { proxy: "http://new:current-secret@proxy:8080", warnDuplicates: false }, queue: [{ id: "restore", title: "Saved song", url: "https://example.com/song", thumbnail: "", preset: "audio", outDir: DL, extra, status: "downloading", progress: 25 }] });
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).queue[0].extra.proxy === null);
check("queue: legacy credentials are scrubbed on startup", !(await page.evaluate(() => localStorage.getItem("__store"))).includes("legacy-secret"));
await page.getByRole("button", { name: "Resume", exact: true }).click();
await waitCalls(page, "start_download", 1);
check("queue: restored downloads use the current proxy", (await calls(page, "start_download"))[0].args.req.extra.proxy === "http://new:current-secret@proxy:8080");
await page.context().close();

const rule = { id: "site", host: "example.com", channel: "", preset: "audio", audioFormat: "", folder: RULE };
page = await open({ store: { mode: "advanced", siteRules: [rule], autoDeleteDays: 7 }, history: [{ ...history[0], path: `${RULE}/Alpha.mp3`, timestamp: 1 }], mock: { library: [{ ...song, path: `${RULE}/Alpha.mp3` }] } });
await nav(page, "Library").click();
await chooseMenu(page, "Library tools", "Music folders");
const dialog = () => page.getByRole("dialog");
await dialog().getByText(RULE, { exact: false }).waitFor();
check("site folder: registered and identified in Music folders", (await dialog().innerText()).includes("Download destination"));
check("site folder: active rules protect folder registration", await dialog().getByRole("button", { name: `Remove folder ${RULE}`, exact: true }).isDisabled());
await dialog().getByRole("button", { name: "Done", exact: true }).click();
await lib(page).getByRole("button", { name: "Play Alpha", exact: true }).click();
await waitCalls(page, "play_in_app", 1);
check("site folder: music can be played", (await calls(page, "play_in_app"))[0].args.path === `${RULE}/Alpha.mp3`);
await page.waitForTimeout(8500);
check("site folder: automatic cleanup leaves it alone", (await calls(page, "delete_files")).length === 0);
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("__store")); s.settings.siteRules = []; localStorage.setItem("__store", JSON.stringify(s)); });
await page.reload(); await nav(page, "Library").click();
await chooseMenu(page, "Library tools", "Music folders");
await dialog().getByRole("button", { name: `Remove folder ${RULE}`, exact: true }).waitFor();
check("site folder: retained after its rule is removed and the app restarts", await dialog().getByRole("button", { name: `Remove folder ${RULE}`, exact: true }).isEnabled());
await dialog().getByRole("button", { name: `Remove folder ${RULE}`, exact: true }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__downloadFolders")).length === 0);
check("site folder: removing its registration never deletes files", (await calls(page, "delete_files")).length === 0);
await page.context().close();

await done();
