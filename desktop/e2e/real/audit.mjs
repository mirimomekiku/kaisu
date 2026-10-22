#!/usr/bin/env node
// Offline audit regressions against the real Tauri backend. All media and app data are temporary.
// Linux with another Kaisu instance open: dbus-run-session -- npm run test:real:audit
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "./webdriver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const binary = process.env.KAISU_BIN ?? resolve(here, "../../src-tauri/target/debug", process.platform === "win32" ? "desktop.exe" : "desktop");
if (!existsSync(binary)) throw new Error("Build the app first: npm run tauri -- build --debug --no-bundle");
const data = mkdtempSync(join(tmpdir(), "kaisu-audit-"));
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

// A tiny valid PCM WAV, avoiding network access or helper-tool dependencies.
const wav = Buffer.alloc(44 + 8000, 128);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36); wav.writeUInt32LE(8000, 40);
const source = join(download, "Song.wav"), target = join(moved, "Song (3).wav"), siteSong = join(site, "Other.wav");
writeFileSync(source, wav); writeFileSync(siteSong, wav);
writeFileSync(join(download, "Song.en.srt"), "subtitles"); writeFileSync(join(download, "Song.lrc"), "lyrics");
writeFileSync(join(moved, "Song.wav"), "existing media"); writeFileSync(join(moved, "Song (2).lrc"), "existing lyrics");

async function call(command, args = {}) {
  await session.script("window.__audit = null; const command = arguments[0], args = arguments[1]; if (command === 'library_scan') args.onProgress = '__CHANNEL__:' + window.__TAURI_INTERNALS__.transformCallback(() => {}); window.__TAURI_INTERNALS__.invoke(command, args).then(value => window.__audit = {value}, error => window.__audit = {error: String(error)});", [command, args]);
  for (let i = 0; i < 150; i++) {
    const result = await session.script("return window.__audit;");
    if (result) { if (result.error) throw new Error(result.error); return result.value; }
    await sleep(100);
  }
  throw new Error(`${command} did not answer`);
}

try {
  for (let i = 0; i < 60; i++) { if (driverError) throw driverError; try { if ((await fetch(`${base}/status`)).ok) break; } catch {} await sleep(250); }
  session = await Session.start(base, binary);
  await session.waitFor(".toolbar, .setup-bg", 30000);
  await sleep(500); // Let the frontend finish its initial folder registration.
  const registration = await call("set_managed_folders", { download, moved, siteFolders: [site] });
  check("site-rule roots register through real IPC", () => assert.equal(registration.problem, null));
  let folders = await call("library_folders");
  check("active destination is exposed for management", () => assert(folders.some((f) => f.path === site && f.configured && f.download_destination)));
  const unsafe = await call("set_managed_folders", { download, moved, siteFolders: [data.split(/[\\/]/)[0] || "/"] }).then(() => false, () => true);
  check("unsafe destination roots are refused", () => assert(unsafe));
  const before = await call("library_scan");
  const original = before.find((t) => t.path === source);
  check("site-rule music participates in scanning", () => assert(original && before.some((t) => t.path === siteSong)));
  await call("play_in_app", { path: siteSong });
  check("site-rule music receives asset authorization", () => assert(existsSync(siteSong)));
  const result = await call("transfer_files", { items: [{ id: "song", path: source }], mode: "move", conflict: "keep_both", keepLayout: true });
  check("real transfer chooses a shared collision-free stem", () => assert.equal(result[0].new_path, target));
  check("subtitles and lyrics retain their association", () => {
    assert.equal(readFileSync(join(moved, "Song (3).en.srt"), "utf8"), "subtitles");
    assert.equal(readFileSync(join(moved, "Song (3).lrc"), "utf8"), "lyrics");
    assert(!existsSync(source)); assert.equal(readFileSync(join(moved, "Song.wav"), "utf8"), "existing media");
  });
  const cached = await call("library_load");
  check("cache relocation preserves the original import date", () => { assert(!cached.some((t) => t.path === source)); assert.equal(cached.find((t) => t.path === target).added, original.added); });
  const reservedSource = join(download, "Reserved.wav"), reservedTarget = join(moved, "Reserved.wav"), part = `${reservedTarget}.kaisu-part`;
  writeFileSync(reservedSource, wav); writeFileSync(part, "another operation");
  const collision = await call("transfer_files", { items: [{ id: "reserved", path: reservedSource }], mode: "copy", conflict: "keep_both", keepLayout: true });
  check("staging collisions preserve both the source and the existing staging file", () => { assert(!collision[0].ok && existsSync(reservedSource) && !existsSync(reservedTarget)); assert.equal(readFileSync(part, "utf8"), "another operation"); });
  const refused = await call("delete_files", { paths: [siteSong], includeMoved: true, permanent: true });
  check("automatic cleanup cannot delete site-rule music", () => assert(!refused[0].ok && existsSync(siteSong)));
  const activeRemoval = await call("library_remove_folder", { path: site }).then(() => false, () => true);
  check("active rule roots cannot be removed", () => assert(activeRemoval));
  await call("set_managed_folders", { download, moved, siteFolders: [] });
  folders = await call("library_folders");
  check("removing a rule retains its former destination", () => assert(folders.some((f) => f.path === site && !f.configured)));
  await call("library_remove_folder", { path: site });
  check("removing registration keeps the files", () => assert(existsSync(siteSong)));
  await call("set_managed_folders", { download, moved, siteFolders: [site] });
  const removed = await call("delete_files", { paths: [siteSong], includeMoved: true, includeLibrary: true, permanent: true });
  check("explicit deletion can act on registered site media", () => assert(removed[0].ok && !existsSync(siteSong)));
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if (session) await session.quit();
  driver.kill();
  await driverClosed;
  rmSync(data, { recursive: true, force: true });
  console.log(`${passed} native audit checks passed`);
}
