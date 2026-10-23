// Audio recovery, pending-load cancellation, output device lifecycle and playback details.
import { open, check, calls, waitCalls, nav, done } from "../harness.mjs";
const root = "/home/u/Music";
const song = (title, track) => ({ path: `${root}/${title}.mp3`, title, artist: "Band", album_artist: "Band", album: "Album", genre: "Rock", year: 2024, track, disc: 1, duration: 120, bitrate: 192, sample_rate: 44100, bit_depth: 16, channels: 2, format: "MP3", size: 1000, modified: 1000, added: 1000, has_cover: false, loudness: -18 });
const A = song("Alpha", 1), B = song("Beta", 2);
const bar = (page) => page.getByRole("region", { name: "Music player", exact: true });
let page = await open({ mock: { library: [A, B], playDelay: 900 } });
await page.addInitScript(() => { window.__audios = []; const Audio = window.Audio; window.Audio = function(...args) { const audio = new Audio(...args); window.__audios.push(audio); return audio; }; window.Audio.prototype = Audio.prototype; });
await page.reload(); await nav(page, "Library").click();
await page.getByRole("button", { name: "Play Alpha", exact: true }).click();
await bar(page).getByRole("button", { name: "Pause", exact: true }).click(); await page.waitForTimeout(1100);
check("pending load: pause prevents a late autoplay", await bar(page).getByRole("button", { name: "Play", exact: true }).count() === 1 && await page.evaluate(() => window.__audios.every((a) => a.paused)));
await bar(page).getByRole("button", { name: "Play", exact: true }).click(); await page.waitForTimeout(1100);
check("pending load: explicit resume starts a new request", (await calls(page, "play_in_app")).filter((c) => c.args.path === A.path).length === 2 && await bar(page).getByRole("button", { name: "Pause", exact: true }).count() === 1);
await page.getByRole("button", { name: "Playback options", exact: true }).click();
const detailsText = await page.getByRole("dialog", { name: "Playback options", exact: true }).innerText();
check("details: file quality and state are visible", ["MP3", "44.1 kHz", "192 kbps", "16-bit"].every((part) => detailsText.includes(part)), detailsText);
await page.getByRole("button", { name: "Close Playback options", exact: true }).click();
await page.context().close();

page = await open({ mock: { library: [A, B], playFailPaths: [A.path], relocations: { [A.path]: { ...A, path: `${root}/Located.mp3` } } } });
await nav(page, "Library").click(); await page.getByRole("button", { name: "Play Alpha", exact: true }).click();
await page.getByRole("button", { name: "Retry playback", exact: true }).waitFor();
check("recovery: failure offers retry, locate and skip", await page.getByRole("button", { name: "Locate audio file", exact: true }).count() === 1 && await page.getByRole("button", { name: "Skip unavailable track", exact: true }).isEnabled());
await page.getByRole("button", { name: "Locate audio file", exact: true }).click();
await page.waitForFunction(() => window.__mock.calls.some((c) => c.cmd === "play_in_app" && c.args.path.endsWith("Located.mp3")));
check("recovery: locating replaces and retries the current track", await bar(page).getByRole("button", { name: "Pause", exact: true }).count() === 1);
await page.context().close();

page = await open({ store: { skipUnavailableTracks: true }, mock: { library: [A, B], playFailPaths: [A.path] } });
await nav(page, "Library").click(); await page.getByRole("button", { name: "Play Alpha", exact: true }).click();
await bar(page).locator(".pb-title").filter({ hasText: "Beta" }).waitFor();
check("recovery: optional skip advances to a working song", (await calls(page, "play_in_app")).some((c) => c.args.path === B.path));
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
await page.getByLabel("Crossfade curve", { exact: true }).selectOption("equalPower");
await page.getByLabel("Preserve album transitions", { exact: true }).uncheck();
check("settings: curve and album policy are persisted", await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("__store")).settings; return s.crossfadeCurve === "equalPower" && s.preserveAlbumTransitions === false; }));
await page.context().close();

page = await open({ store: { audioOutputId: "headphones", audioOutputLabel: "Headphones" }, mock: { library: [A, B] } });
await page.addInitScript(() => {
  window.__sinks = []; window.__outputs = [{ kind: "audiooutput", deviceId: "headphones", label: "Headphones" }, { kind: "audiooutput", deviceId: "speaker", label: "Speakers" }];
  HTMLMediaElement.prototype.setSinkId = async function(id) { if (window.__sinkFail === id) throw new DOMException("Device disconnected", "NotFoundError"); this.__sink = id; window.__sinks.push(id); };
  const devices = new EventTarget(); devices.enumerateDevices = async () => window.__outputs;
  devices.selectAudioOutput = async () => window.__outputs[0];
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: devices });
});
await page.reload(); await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
await page.getByRole("combobox", { name: "Audio output", exact: true }).selectOption("speaker");
check("output: selecting an output persists the preference", await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings.audioOutputId === "speaker"));
await page.evaluate(() => { window.__outputs = window.__outputs.filter((d) => d.deviceId !== "speaker"); navigator.mediaDevices.dispatchEvent(new Event("devicechange")); });
await page.waitForFunction(() => document.querySelector('select[aria-label="Audio output"]').value === "");
check("output: disconnection falls back while keeping the preference", await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings.audioOutputId === "speaker") && (await page.getByRole("main", { name: "settings" }).innerText()).includes("disconnected"));
await page.evaluate(() => { window.__outputs.push({ kind: "audiooutput", deviceId: "speaker", label: "Speakers" }); navigator.mediaDevices.dispatchEvent(new Event("devicechange")); });
await page.waitForFunction(() => document.querySelector('select[aria-label="Audio output"]').value === "speaker");
check("output: reconnect restores the preferred output", true);
await page.evaluate(() => { window.__sinkFail = "headphones"; });
await page.getByRole("combobox", { name: "Audio output", exact: true }).selectOption("headphones");
await page.getByText(/Could not select the output/).waitFor();
check("output: switching failure is visible and keeps the saved preference", await page.getByRole("combobox", { name: "Audio output", exact: true }).inputValue() === "" && await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).settings.audioOutputId === "speaker"));
await page.setViewportSize({ width: 760, height: 540 });
check("playback settings: minimum size fits", await page.locator(".app").evaluate((el) => el.scrollWidth <= innerWidth && el.scrollHeight <= innerHeight));
await page.screenshot({ path: "src-tauri/target/round22-playback.png" });
await page.context().close();
await done();

