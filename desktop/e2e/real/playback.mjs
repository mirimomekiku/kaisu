#!/usr/bin/env node
// Offline playback regressions against the real desktop webview. All media and app data are temporary.
// Linux with another Kaisu instance open: dbus-run-session -- npm run test:real:playback
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "./webdriver.mjs";
import { playbackPrerequisites, writeNativeReport } from "./playback-preflight.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const binary = process.env.KAISU_BIN ?? resolve(here, "../../src-tauri/target/debug", process.platform === "win32" ? "desktop.exe" : "desktop");
const { driver: driverPath, nativeDriver, ffmpeg } = playbackPrerequisites(binary);
const data = mkdtempSync(join(tmpdir(), "kaisu-playback-"));
const download = join(data, "downloads"), moved = join(data, "moved"), site = join(data, "site");
for (const path of [download, moved, site]) mkdirSync(path);
const env = { ...process.env, XDG_DATA_HOME: join(data, "data"), XDG_CONFIG_HOME: join(data, "config"), APPDATA: join(data, "roaming"), LOCALAPPDATA: join(data, "local") };
const appData = join(process.platform === "win32" ? env.APPDATA : env.XDG_DATA_HOME, "com.kaisu.app");
mkdirSync(appData, { recursive: true });
const transitionSources = [join(download, "Transition A.wav"), join(download, "Transition B.wav")];
writeFileSync(join(appData, "kaisu.json"), JSON.stringify({ settings: { autoUpdate: false, outDir: download, moveDir: moved, tourSeen: true, gaplessPlayback: true, crossfadeSeconds: 2, crossfadeCurve: "equalPower", equalizer: { enabled: true, bands: [0, 0, 0, 0, 0, 6, 0, 0, 0, 0], preamp: 0, autoHeadroom: true } }, libraryWatch: false, playlists: [{ id: "native", name: "Native transitions", paths: transitionSources, updated: Date.now() }] }));
const port = await new Promise((done) => { const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => done(port)); }); });
const base = `http://127.0.0.1:${port}`;
const driver = spawn(driverPath, ["--port", String(port), ...(nativeDriver ? ["--native-driver", nativeDriver] : [])], { env, windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
let driverError;
driver.on("error", (error) => { driverError = error; });
const driverClosed = new Promise((done) => driver.once("close", done));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let session, passed = 0;
const check = (name, action) => { action(); passed++; console.log(`ok ${name}`); };

async function call(command, args = {}) {
  await session.script("window.__audit = null; const command = arguments[0], args = arguments[1]; if (command === 'library_scan') args.onProgress = '__CHANNEL__:' + window.__TAURI_INTERNALS__.transformCallback(() => {}); window.__TAURI_INTERNALS__.invoke(command, args).then(value => window.__audit = {value}, error => window.__audit = {error: String(error)});", [command, args]);
  for (let i = 0; i < 150; i++) {
    const result = await session.script("return window.__audit;");
    if (result) { if (result.error) throw new Error(result.error); return result.value; }
    await sleep(100);
  }
  throw new Error(`${command} did not answer`);
}

const formats = ["wav", "mp3", "m4a", "flac", "opus"];
const sources = formats.map((ext) => join(download, `Sound #100% café.${ext}`));
try {
  for (const path of sources) execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-y", path], { windowsHide: true });
  for (const path of transitionSources) execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-y", path], { windowsHide: true });
  const longPath = join(download, "Long recording.wav");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1200:sample_rate=8000", "-y", longPath], { windowsHide: true });
  for (let i = 0; i < 60; i++) { if (driverError) throw driverError; try { if ((await fetch(`${base}/status`)).ok) break; } catch {} await sleep(250); }
  session = await Session.start(base, binary);
  await session.waitFor(".toolbar, .setup-bg", 30000);
  await sleep(500);
  await call("set_managed_folders", { download, moved, siteFolders: [] });
  for (const path of sources) {
    const url = await call("play_in_app", { path });
    check("stream URL hides the file path", () => assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}$/));
    const full = await fetch(url);
    check("stream allows anonymous Web Audio access", () => assert.equal(full.headers.get("access-control-allow-origin"), "*"));
    const cors = await fetch(url, { method: "OPTIONS", headers: { Origin: "tauri://localhost", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Range" } });
    check("range preflight remains capability-scoped", () => { assert.equal(cors.status, 204); assert.equal(cors.headers.get("access-control-allow-headers"), "Range"); });
    const bytes = new Uint8Array(await full.arrayBuffer());
    check("full stream has a known length and supports seeking", () => { assert.equal(full.status, 200); assert.equal(Number(full.headers.get("content-length")), bytes.length); assert.equal(full.headers.get("accept-ranges"), "bytes"); });
    const partial = await fetch(url, { headers: { Range: "bytes=10-99" } });
    const partBytes = new Uint8Array(await partial.arrayBuffer());
    check("byte ranges return the exact requested bytes", () => { assert.equal(partial.status, 206); assert.deepEqual(partBytes, bytes.slice(10, 100)); });
    const invalid = await fetch(url, { headers: { Range: `bytes=${bytes.length}-` } });
    check("out-of-bounds ranges are refused", () => assert.equal(invalid.status, 416));
    const head = await fetch(url, { method: "HEAD" });
    const body = await head.arrayBuffer();
    check("HEAD reports the file without returning its contents", () => { assert.equal(Number(head.headers.get("content-length")), bytes.length); assert.equal(head.status, 200); assert.equal(body.byteLength, 0); });
    await session.script(`window.__sound?.pause(); const a = window.__sound = new Audio(); window.__playback = {events:[]}; for (const type of ['error','playing','seeked']) a.addEventListener(type, () => window.__playback.events.push(type)); a.src = arguments[0]; a.play().catch(e => window.__playback.error = e.message);`, [url]);
    for (let i = 0; i < 100; i++) { const result = await session.script("return {time:window.__sound.currentTime, error:window.__sound.error?.code, rejected:window.__playback.error};"); if (result.error || result.rejected) throw new Error(JSON.stringify(result)); if (result.time > 0.15) break; await sleep(100); }
    const playing = await session.script("return {time:window.__sound.currentTime, playing:!window.__sound.paused, events:window.__playback.events};");
    check(`real desktop decoder plays ${path.split('.').at(-1)} audio`, () => assert(playing.playing && playing.time > 0.15 && playing.events.includes("playing"), JSON.stringify(playing)));
    await session.script("window.__sound.currentTime = 5;"); await sleep(300);
    const sought = await session.script("return window.__sound.currentTime >= 5 && !window.__sound.paused && window.__playback.events.includes('seeked');");
    check("seeking continues playback", () => assert(sought));
    await session.script("window.__sound.pause();");
    const refused = await fetch(url.replace(/[^/]+$/, "0".repeat(32)));
    check("unregistered capabilities cannot read media", () => assert.equal(refused.status, 404));
  }
  const longUrl = await call("play_in_app", { path: longPath });
  await session.script("window.__sound.pause(); window.__sound.src = arguments[0]; window.__sound.play();", [longUrl]);
  for (let i = 0; i < 100; i++) { if (await session.script("return window.__sound.duration >= 1199;")) break; await sleep(100); }
  await session.script("window.__sound.currentTime = 1000;"); await sleep(500);
  const longSeek = await session.script("return window.__sound.currentTime >= 1000 && !window.__sound.paused;");
  check("long recordings seek beyond sixteen minutes", () => assert(longSeek));
  await session.script("window.__sound.pause();");
  const corruptPath = join(download, "Damaged.wav"); writeFileSync(corruptPath, "not an audio file");
  const corruptUrl = await call("play_in_app", { path: corruptPath });
  await session.script("window.__decodeFailed = false; const bad = window.__badSound = new Audio(arguments[0]); bad.onerror = () => window.__decodeFailed = true; bad.play().catch(() => window.__decodeFailed = true);", [corruptUrl]);
  for (let i = 0; i < 50; i++) { if (await session.script("return window.__decodeFailed;")) break; await sleep(100); }
  const decodeFailed = await session.script("return window.__decodeFailed;");
  check("corrupt native audio is rejected", () => assert(decodeFailed));
  await session.script("window.__badSound.src = ''; window.__sound.src = ''; ");
  renameSync(longPath, longPath + ".offline");
  const disconnected = await fetch(longUrl);
  check("disconnected media path is refused on a new request", () => assert.equal(disconnected.status, 403));
  renameSync(longPath + ".offline", longPath);
  const outside = join(data, "not-authorized.wav");
  writeFileSync(outside, Buffer.alloc(44));
  const unknown = await call("play_in_app", { path: outside }).then(() => false, () => true);
  check("IPC refuses files outside registered folders", () => assert(unknown));
  const revokedPath = join(site, "Revoked.wav");
  writeFileSync(revokedPath, Buffer.alloc(44));
  await call("set_managed_folders", { download, moved, siteFolders: [site] });
  const revokedUrl = await call("play_in_app", { path: revokedPath });
  await call("set_managed_folders", { download, moved, siteFolders: [] });
  await call("library_remove_folder", { path: site });
  const revoked = await fetch(revokedUrl);
  check("removed folder authorization is rechecked on seeks", () => assert.equal(revoked.status, 403));
  await session.script(`window.__nativeContexts = []; window.__nativeGains = []; const Context = window.AudioContext; window.AudioContext = class extends Context { constructor(...args) { super(...args); window.__nativeContexts.push(this); } createGain() { const gain = super.createGain(); window.__nativeGains.push(gain); return gain; } }; window.__nativeAudios = []; const original = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function(...args) { window.__activeSound = this; if (!window.__nativeAudios.includes(this)) window.__nativeAudios.push(this); window.__volumeAtPlay = {volume:this.volume, muted:this.muted}; return original.apply(this,args); }; document.querySelectorAll('.sidebar .source')[3].click();`);
  await session.click(await session.waitFor('button[aria-label^="Play Sound"]'));
  for (let i = 0; i < 100; i++) { if (await session.script("return window.__activeSound?.currentTime > .2;")) break; await sleep(100); }
  const player = await session.script("return {time:window.__activeSound?.currentTime, error:document.querySelector('.pb-sub[role=alert]')?.textContent, paused:window.__activeSound?.paused};");
  check("Library play starts the persistent music player", () => assert(player.time > .2 && !player.paused && !player.error, JSON.stringify(player)));
  const initialVolume = await session.script("return {before:window.__volumeAtPlay, volume:window.__activeSound.volume, muted:window.__activeSound.muted};");
  check("first Library playback starts at 100% and unmuted without slider input", () => assert.deepEqual(initialVolume, {before:{volume:1, muted:false}, volume:1, muted:false}));
  await session.script("const context = window.__nativeContexts[0]; const analyser = window.__eqAnalyser = context.createAnalyser(); window.__nativeGains[0].connect(analyser);");
  await sleep(250);
  const eqSignal = await session.script("const samples = new Float32Array(window.__eqAnalyser.fftSize); window.__eqAnalyser.getFloatTimeDomainData(samples); return {running:window.__nativeContexts[0].state === 'running', rms:Math.sqrt(samples.reduce((sum,x) => sum + x*x,0)/samples.length), cors:window.__activeSound.crossOrigin};");
  check("native equalizer receives non-silent CORS-readable audio", () => assert(eqSignal.running && eqSignal.rms > 0.001 && eqSignal.cors === "anonymous", JSON.stringify(eqSignal)));
  await session.click(await session.waitFor('.playerbar button[aria-label="Pause"]'));
  await session.script("window.__beforeFullAudio = window.__activeSound;");
  await session.click(await session.waitFor('button[aria-label="Open full-screen player"]'));
  await session.waitFor('[aria-label="Full-screen player"]');
  for (let i = 0; i < 30; i++) { if (await call("plugin:window|is_fullscreen", { label: "main" })) break; await sleep(100); }
  const nativeFull = await call("plugin:window|is_fullscreen", { label: "main" });
  check("full-screen player enters the native OS fullscreen state", () => assert.equal(nativeFull, true));
  const sameAudio = await session.script("return window.__activeSound === window.__beforeFullAudio && window.__activeSound.paused;");
  check("expanding preserves the paused audio element", () => assert(sameAudio));
  const fits = await session.script("const el = document.querySelector('.full-player'); return el.scrollWidth <= innerWidth && el.scrollHeight <= innerHeight;");
  check("native full-screen layout fits the monitor", () => assert(fits));
  await session.click(await session.waitFor('.full-player button[aria-label="Play"]'));
  for (let i = 0; i < 30; i++) { if (await session.script("return !window.__activeSound.paused;")) break; await sleep(100); }
  const playingFull = await session.script("return !window.__activeSound.paused && window.__activeSound === window.__beforeFullAudio;");
  check("full-screen transport controls the original audio element", () => assert(playingFull));
  await session.press("");
  for (let i = 0; i < 50; i++) { if (!(await call("plugin:window|is_fullscreen", { label: "main" })) && !(await session.find('.full-player'))) break; await sleep(100); }
  const restored = !(await call("plugin:window|is_fullscreen", { label: "main" })) && !(await session.find('.full-player'));
  check("Escape restores the native window and regular player", () => assert(restored));
  const interactive = await session.script("return !document.querySelector('.app-body').inert && document.activeElement?.getAttribute('aria-label') === 'Open full-screen player';");
  check("native exit restores app interaction and focus", () => assert(interactive));
  // Drive the app's queue and crossfade rather than isolated Audio elements.
  await session.script("const view = document.querySelector('select[aria-label=\"Library view\"]'); view.value = 'playlists'; view.dispatchEvent(new Event('change', {bubbles:true}));");
  await session.click(await session.waitFor('button[aria-label="Open Native transitions"]'));
  await session.script("[...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Play playlist').click();"); await sleep(600);
  await session.script("window.__activeSound.currentTime = 10.3;");
  for (let i = 0; i < 60; i++) { if (await session.script("return window.__nativeAudios.filter(a => !a.paused).length === 2;")) break; await sleep(50); }
  const overlap = await session.script("return window.__nativeAudios.filter(a => !a.paused).length === 2;");
  check("real native crossfade plays two decks", () => assert(overlap));
  await session.click(await session.waitFor('.playerbar button[aria-label="Pause"]'));
  const allPaused = await session.script("return window.__nativeAudios.every(a => a.paused);");
  check("native pause stops both crossfade decks", () => assert(allPaused));
  await session.click(await session.waitFor('.playerbar button[aria-label="Play"]'));
  await sleep(200);
  for (let i = 0; i < 5; i++) { await session.click(await session.waitFor('.playerbar button[aria-label="Previous track"]')); await session.click(await session.waitFor('.playerbar button[aria-label="Next track"]')); }
  await session.click(await session.waitFor('.playerbar button[aria-label="Pause"]')); await sleep(500);
  const rapidPaused = await session.script("return window.__nativeAudios.every(a => a.paused);");
  check("rapid native skipping followed by pause leaves no playing deck", () => assert(rapidPaused));
  await session.script("document.querySelectorAll('.sidebar .source')[1].click();");
  await session.waitFor('select[aria-label="Download status"]');
  const dropdown = await session.script("const el = document.querySelector('select[aria-label=\"Download status\"]'); const style = getComputedStyle(el); const ctx = document.createElement('canvas').getContext('2d'); ctx.font = style.font; const needed = ctx.measureText(el.selectedOptions[0].textContent).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight); return {width:el.clientWidth,needed,height:el.clientHeight,font:parseFloat(style.fontSize)};");
  check("native download dropdown displays the complete selected label", () => assert(dropdown.width >= dropdown.needed - 1 && dropdown.height >= dropdown.font + 8, JSON.stringify(dropdown)));

} catch (error) {
  writeNativeReport("failed", passed, [String(error)]);
  console.error(error); process.exitCode = 1;
} finally {
  if (session) await session.quit();
  driver.kill(); await driverClosed;
  rmSync(data, { recursive: true, force: true });
  if (!process.exitCode) writeNativeReport("passed", passed);
  console.log(`${passed} native playback checks passed`);
}
