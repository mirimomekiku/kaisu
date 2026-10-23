// Real WebView2 DSP + Rust media-stream test. No downloader, ffmpeg or WebDriver is required.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { rolldown } from "rolldown";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.platform !== "win32") throw new Error("This runner uses WebView2 on Windows. Use test:real:playback with tauri-driver on Linux.");
const binary = process.env.KAISU_BIN ?? join(desktop, "src-tauri/target/debug/desktop.exe");
if (!existsSync(binary)) throw new Error("Build the debug desktop app first.");
const data = mkdtempSync(join(tmpdir(), "kaisu-eq-native-"));
const music = join(data, "music"); mkdirSync(music);
const roaming = join(data, "roaming"), local = join(data, "local");
const appData = join(roaming, "com.kaisu.app"); mkdirSync(appData, { recursive: true });
writeFileSync(join(appData, "kaisu.json"), JSON.stringify({ settings: { outDir: music, autoUpdate: false, tourSeen: true } }));
const audioPath = join(music, "EQ tone.wav");
const rate = 48000, samples = rate * 30, wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 1000 * i / rate) * 1600), 44 + i * 2);
writeFileSync(audioPath, wav);
const port = await new Promise((done) => { const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => done(port)); }); });
let app, browser, passed = 0, failure;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const check = (name, result) => { assert(result, name); passed++; console.log(`ok ${name}`); };
try {
  const bundle = await rolldown({ input: join(desktop, "src/lib/equalizerGraph.ts") });
  const { output } = await bundle.generate({ format: "iife", name: "KaisuEqualizer" }); await bundle.close();
  app = spawn(binary, [], { windowsHide: true, env: { ...process.env, APPDATA: roaming, LOCALAPPDATA: local, WEBVIEW2_USER_DATA_FOLDER: join(data, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port} --autoplay-policy=no-user-gesture-required` }, stdio: ["ignore", "ignore", "pipe"] });
  let startError; app.on("error", (error) => { startError = error; });
  for (let i = 0; i < 120; i++) {
    if (startError) throw startError;
    if (app.exitCode !== null) throw new Error("Desktop exited before the test connected. Close any existing Kaisu instance first.");
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    await sleep(250);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
  const page = browser.contexts()[0].pages()[0]; await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  // Wait for startup settings/managed-root registration before assigning the isolated test root.
  await page.locator(".toolbar, .setup-bg").first().waitFor({ timeout: 30000 });
  await page.evaluate(async (music) => window.__TAURI_INTERNALS__.invoke("set_managed_folders", { download: music, moved: "", siteFolders: [] }), music);
  const url = await page.evaluate(async (path) => window.__TAURI_INTERNALS__.invoke("play_in_app", { path }), audioPath);
  const response = await fetch(url); check("native stream is CORS-readable", response.headers.get("access-control-allow-origin") === "*");
  assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, wav.length);
  const cdp = await page.context().newCDPSession(page);
  const injected = await cdp.send("Runtime.evaluate", { expression: output.find((item) => item.type === "chunk").code });
  if (injected.exceptionDetails) throw new Error(injected.exceptionDetails.text);
  await page.evaluate(async (url) => {
    const context = window.__eqContext = new AudioContext();
    const graph = window.__eqGraph = new window.KaisuEqualizer.EqualizerGraph(() => context);
    const audio = window.__eqAudio = new Audio(); audio.crossOrigin = "anonymous"; audio.loop = true;
    await graph.activate(); graph.attach(audio);
    const analyser = window.__eqAnalyser = context.createAnalyser(); graph.preamp.connect(analyser);
    audio.src = url; await audio.play();
  }, url);
  const rms = async () => { await sleep(250); return page.evaluate(() => { const samples = new Float32Array(window.__eqAnalyser.fftSize); window.__eqAnalyser.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length); }); };
  const flat = await rms(); check("real WebView2 receives non-silent local audio", flat > 0.01);
  await page.evaluate(() => window.__eqGraph.configure({ enabled: true, preamp: 0, autoHeadroom: false, bands: [0, 0, 0, 0, 0, 6, 0, 0, 0, 0] }));
  const boost = await rms(); check("native EQ boosts 1 kHz by six decibels", Math.abs(boost / flat - Math.pow(10, 6 / 20)) < 0.08);
  await page.evaluate(() => window.__eqGraph.configure({ enabled: true, preamp: 0, autoHeadroom: true, bands: [0, 0, 0, 0, 0, 6, 0, 0, 0, 0] }));
  check("native automatic headroom offsets boost", Math.abs(await rms() / flat - 1) < 0.06);
  await page.evaluate(() => window.__eqGraph.configure({ enabled: false }));
  check("native bypass returns to flat", Math.abs(await rms() / flat - 1) < 0.06);
  await page.evaluate(() => { window.__eqAudio.volume = 0.5; });
  check("native volume still controls processed audio", Math.abs(await rms() / flat - 0.5) < 0.04);
  await page.evaluate(() => { window.__eqAudio.muted = true; });
  check("native mute silences processed audio", await rms() < 0.0001);
  await page.evaluate(async (url) => {
    const second = window.__eqSecond = new Audio(); second.crossOrigin = "anonymous"; second.loop = true; window.__eqGraph.attach(second); second.src = url; await second.play();
  }, url);
  check("the second crossfade deck uses the shared processor", await rms() > 0.01);
  await page.evaluate(() => { window.__eqAudio.pause(); window.__eqSecond.pause(); });
  check("pausing both decks silences the mix", await rms() < 0.0001);
  await page.evaluate(() => window.__eqGraph.dispose());
} catch (error) { failure = String(error); console.error(error); process.exitCode = 1; }
finally {
  if (browser) await browser.close().catch(() => {});
  if (app && app.exitCode === null) { const closed = new Promise((done) => app.once("close", done)); app.kill(); await Promise.race([closed, sleep(5000)]); }
  const report = join(desktop, "src-tauri/target/equalizer-native-report.json"); mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, JSON.stringify({ platform: process.platform, at: new Date().toISOString(), status: failure ? "failed" : "passed", checks: passed, error: failure ?? null }, null, 2));
  for (let attempt = 0; attempt < 8; attempt++) {
    try { rmSync(data, { recursive: true, force: true }); break; }
    catch { if (attempt === 7) console.log(`Temporary native-test profile still in use: ${data}`); else await sleep(250); }
  }
  console.log(`${passed} native equalizer checks passed`);
}
