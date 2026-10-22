#!/usr/bin/env node
// Offline playback regressions against the real desktop webview. All media and app data are temporary.
// Linux with another Kaisu instance open: dbus-run-session -- npm run test:real:playback
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "./webdriver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const binary = process.env.KAISU_BIN ?? resolve(here, "../../src-tauri/target/debug", process.platform === "win32" ? "desktop.exe" : "desktop");
if (!existsSync(binary)) throw new Error("Build the app first: npm run tauri -- build --debug --no-bundle");
const data = mkdtempSync(join(tmpdir(), "kaisu-playback-"));
const download = join(data, "downloads"), moved = join(data, "moved"), site = join(data, "site");
for (const path of [download, moved, site]) mkdirSync(path);
const env = { ...process.env, XDG_DATA_HOME: join(data, "data"), XDG_CONFIG_HOME: join(data, "config"), APPDATA: join(data, "roaming"), LOCALAPPDATA: join(data, "local") };
const appData = join(process.platform === "win32" ? env.APPDATA : env.XDG_DATA_HOME, "com.kaisu.app");
mkdirSync(appData, { recursive: true });
writeFileSync(join(appData, "kaisu.json"), JSON.stringify({ settings: { autoUpdate: false, outDir: download, moveDir: moved, tourSeen: true }, libraryWatch: false }));
const port = await new Promise((done) => { const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => done(port)); }); });
const base = `http://127.0.0.1:${port}`;
const driver = spawn("tauri-driver", ["--port", String(port), ...(process.env.KAISU_NATIVE_DRIVER ? ["--native-driver", process.env.KAISU_NATIVE_DRIVER] : [])], { env, stdio: ["ignore", "inherit", "inherit"] });
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

const ffmpeg = resolve(here, `../../../bin/ffmpeg${process.platform === "win32" ? ".exe" : ""}`);
const formats = ["wav", "mp3", "m4a", "flac", "opus"];
const sources = formats.map((ext) => join(download, `Sound #100% café.${ext}`));
try {
  for (const path of sources) execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-y", path]);
  for (let i = 0; i < 60; i++) { if (driverError) throw driverError; try { if ((await fetch(`${base}/status`)).ok) break; } catch {} await sleep(250); }
  session = await Session.start(base, binary);
  await session.waitFor(".toolbar, .setup-bg", 30000);
  await sleep(500);
  await call("set_managed_folders", { download, moved, siteFolders: [] });
  for (const path of sources) {
    const url = await call("play_in_app", { path });
    check("stream URL hides the file path", () => assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}$/));
    const full = await fetch(url);
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
  await session.script(`const original = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function(...args) { window.__activeSound = this; window.__volumeAtPlay = {volume:this.volume, muted:this.muted}; return original.apply(this,args); }; document.querySelectorAll('.sidebar .source')[3].click();`);
  await session.click(await session.waitFor('button[aria-label^="Play Sound"]'));
  for (let i = 0; i < 100; i++) { if (await session.script("return window.__activeSound?.currentTime > .2;")) break; await sleep(100); }
  const player = await session.script("return {time:window.__activeSound?.currentTime, error:document.querySelector('.pb-sub[role=alert]')?.textContent, paused:window.__activeSound?.paused};");
  check("Library play starts the persistent music player", () => assert(player.time > .2 && !player.paused && !player.error, JSON.stringify(player)));
  const initialVolume = await session.script("return {before:window.__volumeAtPlay, volume:window.__activeSound.volume, muted:window.__activeSound.muted};");
  check("first Library playback starts at 100% and unmuted without slider input", () => assert.deepEqual(initialVolume, {before:{volume:1, muted:false}, volume:1, muted:false}));

} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if (session) await session.quit();
  driver.kill(); await driverClosed;
  rmSync(data, { recursive: true, force: true });
  console.log(`${passed} native playback checks passed`);
}
