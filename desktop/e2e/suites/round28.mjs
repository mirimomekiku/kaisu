// Player practice tools, profiles, opt-in waveforms and listening-session recovery.
import { open, check, calls, waitCalls, nav, chooseMenu, done } from "../harness.mjs";
const DL = "/home/u/Downloads";
const song = (title) => ({ path: `${DL}/${title}.wav`, title, artist: "Band", album_artist: "", album: "Practice", track: null, disc: null, year: 2024, genre: "Rock", duration: 120, bitrate: 1411, sample_rate: 44100, bit_depth: 16, channels: 2, format: "WAV", size: 1000, modified: 1000, added: 1000, has_cover: false, loudness: -18 });
const A = song("Alpha"), B = song("Beta");
const bar = (p) => p.getByRole("region", { name: "Music player", exact: true });
const options = (p) => p.getByRole("dialog", { name: "Playback options", exact: true });
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("__store")));
async function launch(extra = {}) {
  const page = await open({ mock: { library: [A, B], audioSeconds: 120, ...extra } });
  await nav(page, "Library").click(); await page.getByRole("button", { name: "Play Alpha", exact: true }).click();
  await bar(page).getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Seek"]')?.max) === 120);
  return page;
}
let page = await launch();
check("waveform: disabled by default without backend analysis", (await calls(page, "media_waveform")).length === 0 && await page.getByRole("img", { name: "Audio waveform", exact: true }).count() === 0);
await bar(page).getByLabel("Seek", { exact: true }).fill("5");
await bar(page).getByRole("button", { name: "Playback options", exact: true }).click();
await options(page).getByRole("button", { name: "Set A", exact: true }).click();
await bar(page).getByLabel("Seek", { exact: true }).fill("8");
if (!(await options(page).isVisible())) await bar(page).getByRole("button", { name: "Playback options", exact: true }).click();
await options(page).getByRole("button", { name: "Set B", exact: true }).click();
await options(page).getByLabel("Enable A–B loop", { exact: true }).check();
check("loop: valid points enable shared-engine looping", await options(page).getByLabel("Enable A–B loop", { exact: true }).isChecked());
await page.keyboard.press("Escape");
await bar(page).getByLabel("Seek", { exact: true }).fill("7");
await page.waitForTimeout(1700);
check("loop: reaching B returns to A without changing track", await bar(page).locator(".pb-title").innerText() === "Alpha" && Number(await bar(page).getByLabel("Seek", { exact: true }).inputValue()) < 8);
await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
await bar(page).getByRole("button", { name: "Open full-screen player", exact: true }).click();
const full = () => page.getByRole("dialog", { name: "Full-screen player", exact: true });
await full().getByRole("button", { name: "Playback tools", exact: true }).click();
check("loop: full-screen controls share the active loop", await page.getByRole("dialog", { name: "Playback tools", exact: true }).getByLabel("Enable A–B loop").isChecked());
await page.getByRole("dialog", { name: "Playback tools", exact: true }).getByRole("button", { name: "Clear loop", exact: true }).click();
await page.keyboard.press("Escape"); await full().getByRole("button", { name: "Exit full-screen player", exact: true }).click();
await bar(page).getByRole("button", { name: "Playback options", exact: true }).click();
await options(page).getByLabel("Playback profile", { exact: true }).selectOption("spoken");
check("profiles: speech applies speed, transitions and resume choices", (await saved(page)).settings.activePlaybackProfile === "spoken" && (await saved(page)).settings.gaplessPlayback === false && await options(page).getByLabel("Playback speed", { exact: true }).inputValue() === "1.25");
await options(page).getByLabel("Playback speed", { exact: true }).selectOption("1.5");
check("profiles: manual changes switch to custom settings", (await saved(page)).settings.activePlaybackProfile === "");
await page.keyboard.press("Escape");
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
await page.getByLabel("New playback profile name", { exact: true }).fill("My speech");
await page.getByRole("button", { name: "Save current as new profile", exact: true }).click();
check("profiles: custom profiles save the current rate", (await saved(page)).settings.playbackProfiles.some((p) => p.name === "My speech" && p.rate === 1.5));
const customId = (await saved(page)).settings.playbackProfiles.find((p) => p.name === "My speech").id;
await page.getByLabel("Profile to update", { exact: true }).selectOption(customId);
await page.getByLabel("Remember long-track positions", { exact: true }).uncheck();
await page.getByRole("button", { name: "Update saved profile", exact: true }).click();
check("profiles: existing profiles can be updated after custom edits", (await saved(page)).settings.playbackProfiles.find((p) => p.id === customId).resumeLongTracks === false);

await page.getByLabel("Waveform seek bar", { exact: true }).check();
await bar(page).getByRole("img", { name: "Audio waveform", exact: true }).waitFor();
check("waveform: enabling settings requests local peaks", (await calls(page, "media_waveform")).length === 1);
await bar(page).getByRole("button", { name: "Open full-screen player", exact: true }).click();
await full().getByRole("img", { name: "Audio waveform", exact: true }).waitFor();
check("waveform: full-screen shares cached analysis", (await calls(page, "media_waveform")).length === 1);
await page.setViewportSize({ width: 720, height: 576 });
for (const theme of ["aqua", "graphite", "dark"]) {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  check(`player: waveform fits minimum-size ${theme} fullscreen`, await full().evaluate((el) => el.scrollWidth <= innerWidth && el.scrollHeight <= innerHeight && el.querySelector(".full-track").getBoundingClientRect().bottom <= el.querySelector(".full-transport").getBoundingClientRect().top));
}
await page.screenshot({ path: "src-tauri/target/player-tools-waveform.png" });
await page.setViewportSize({ width: 1060, height: 800 });

await full().getByRole("button", { name: "Exit full-screen player", exact: true }).click();

await page.getByLabel("Waveform seek bar", { exact: true }).uncheck();
check("waveform: disabling restores the normal seek bar", await bar(page).getByRole("img", { name: "Audio waveform", exact: true }).count() === 0 && await bar(page).getByLabel("Seek", { exact: true }).isEnabled());
await page.reload(); await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
check("profiles: custom profile and waveform-off preference survive restart", (await saved(page)).settings.playbackProfiles.some((p) => p.name === "My speech") && !(await page.getByLabel("Waveform seek bar", { exact: true }).isChecked()));
await page.context().close();

page = await launch({ waveformDelay: 1500 });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
await page.getByLabel("Waveform seek bar", { exact: true }).check(); await waitCalls(page, "media_waveform", 1);
await page.getByLabel("Waveform seek bar", { exact: true }).uncheck(); await waitCalls(page, "cancel_waveform", 1);
await page.waitForTimeout(1600);
check("waveform: disabling cancels analysis and ignores its late result", await page.getByRole("img", { name: "Audio waveform", exact: true }).count() === 0);
await page.context().close();

page = await launch({ waveformFail: true });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
await page.getByLabel("Waveform seek bar", { exact: true }).check(); await page.getByText("Waveform unavailable", { exact: true }).waitFor();
check("waveform: failures preserve playback and seeking", await bar(page).getByRole("button", { name: "Pause", exact: true }).isEnabled() && await bar(page).getByLabel("Seek", { exact: true }).isEnabled());
await page.context().close();

page = await launch();
await bar(page).getByLabel("Seek", { exact: true }).fill("25"); await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
await nav(page, "Library").click(); await page.getByLabel("Library view", { exact: true }).selectOption("listening");
const sessions = () => page.getByRole("region", { name: "Listening sessions", exact: true });
await sessions().getByRole("button", { name: "Rename session Practice", exact: true }).waitFor();
await sessions().getByRole("button", { name: "Rename session Practice", exact: true }).click();
await page.getByLabel("Session name", { exact: true }).fill("Evening queue"); await page.getByRole("button", { name: "Save session name", exact: true }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).listeningSessions?.some((s) => s.name === "Evening queue"));
check("sessions: automatic snapshots include queue and position", (await saved(page)).listeningSessions[0].player.queue.length === 2 && (await saved(page)).listeningSessions[0].player.position >= 25);
await page.getByLabel("Library view", { exact: true }).selectOption("songs");
await page.getByRole("button", { name: "Play Beta", exact: true }).click();
await bar(page).getByRole("button", { name: "Pause", exact: true }).waitFor();
await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
await page.getByLabel("Library view", { exact: true }).selectOption("listening");
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).listeningSessions?.length === 2);
check("sessions: a new queue preserves the previous session", (await saved(page)).listeningSessions.some((s) => s.name === "Evening queue" && s.player.queue.length === 2) && (await saved(page)).listeningSessions.some((s) => s.name !== "Evening queue" && s.player.queue.length === 1));
await sessions().getByRole("button", { name: "Save session Evening queue as playlist", exact: true }).click();
await page.getByLabel("New playlist name", { exact: true }).fill("Evening mix"); await page.getByRole("button", { name: "Create and add", exact: true }).click();
check("sessions: snapshots can become playlists", (await saved(page)).playlists.some((p) => p.name === "Evening mix" && p.paths.length === 2));
await page.reload(); await nav(page, "Library").click(); await page.getByLabel("Library view", { exact: true }).selectOption("listening");
await sessions().getByRole("button", { name: "Restore session Evening queue", exact: true }).click();
check("sessions: history survives restart and restores paused", await bar(page).getByRole("button", { name: "Play", exact: true }).count() === 1 && Number(await bar(page).getByLabel("Seek", { exact: true }).inputValue()) >= 25);
await sessions().getByRole("button", { name: "Clear session history", exact: true }).click();
await sessions().getByRole("button", { name: "Cancel", exact: true }).click();
check("sessions: cancelling clear keeps the history", await sessions().getByRole("button", { name: "Restore session Evening queue", exact: true }).count() === 1);
await sessions().getByRole("button", { name: "Clear session history", exact: true }).click(); await sessions().getByRole("button", { name: "Clear saved sessions", exact: true }).click();
check("sessions: clearing history keeps playlists", (await saved(page)).playlists.some((p) => p.name === "Evening mix"));
await page.context().close();
await done();
