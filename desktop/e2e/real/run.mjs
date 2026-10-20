#!/usr/bin/env node
// Drives the REAL app (the built executable, real Rust backend, real window) through tauri-driver.
//
//   npm run build -- ... then: npm run tauri build -- --debug --no-bundle   (or build:exe for release)
//   npm run test:real
//
// Needs: `cargo install tauri-driver --locked`, and a WebDriver for the platform's webview
// (Linux: WebKitWebDriver from webkit2gtk-driver; Windows: msedgedriver, via KAISU_NATIVE_DRIVER).
// Uses an isolated data folder, so it never touches your real Kaisu settings or history.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keys, Session } from "./webdriver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === "win32" ? ".exe" : "";
const target = resolve(here, "../../src-tauri/target");
const binary =
  process.env.KAISU_BIN ?? [join(target, "release", `desktop${exe}`), join(target, "debug", `desktop${exe}`)].find((p) => existsSync(p));
if (!binary) {
  console.error("No built app found. Build it first: npm run tauri build -- --debug --no-bundle");
  process.exit(2);
}

const PORT = 4444;
const BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "kaisu-real-"));
// The app stores its data under the platform's data folder; point that at a throwaway directory.
const env = { ...process.env, XDG_DATA_HOME: join(data, "data"), XDG_CONFIG_HOME: join(data, "config"), APPDATA: join(data, "roaming"), LOCALAPPDATA: join(data, "local") };

let passed = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${ok ? "" : `  ${extra}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const driverArgs = ["--port", String(PORT)];
if (process.env.KAISU_NATIVE_DRIVER) driverArgs.push("--native-driver", process.env.KAISU_NATIVE_DRIVER);
const driver = spawn("tauri-driver", driverArgs, { env, stdio: ["ignore", "inherit", "inherit"] });
driver.on("error", (e) => {
  console.error(`Could not start tauri-driver (${e.message}). Install it with: cargo install tauri-driver --locked`);
  process.exit(2);
});

async function driverReady() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/status`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("tauri-driver did not start");
}

/** Waits for the app to get past start-up: the main window, or the first-run setup screen. */
async function waitForApp(s) {
  await s.waitFor(".toolbar, .setup-bg", 30000);
  return (await s.find(".toolbar")) ? "main" : "setup";
}

// Promises can't be returned through WebDriver's synchronous execute, so poll a global the page fills in.
async function call(s, cmd, args = {}) {
  await s.script("window.__real = undefined; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((v) => (window.__real = { ok: v }), (e) => (window.__real = { err: String(e) }));", [cmd, args]);
  for (let i = 0; i < 100; i++) {
    const r = await s.script("return window.__real;");
    if (r) return r;
    await sleep(100);
  }
  throw new Error(`${cmd} never answered`);
}

let session;
try {
  await driverReady();
  console.log(`Real app: ${binary}\nData:     ${data}\n`);

  // ---------- first launch ----------
  session = await Session.start(BASE, binary);
  const state = await waitForApp(session);
  check("the app starts and shows a window", state === "main" || state === "setup", state);
  check("the real Tauri backend is attached", (await session.script("return typeof window.__TAURI_INTERNALS__")) === "object");

  const info = await call(session, "check_setup");
  check("check_setup answers from the real Rust backend", !!info.ok && typeof info.ok.platform?.os === "string", JSON.stringify(info));
  check("the platform is detected", ["linux", "windows"].includes(info.ok?.platform?.os), info.ok?.platform?.os);
  const tray = await call(session, "tray_available");
  check("tray_available answers (true or false, no crash)", typeof tray.ok === "boolean", JSON.stringify(tray));
  const space = await call(session, "free_space", { path: tmpdir() });
  check("free_space reads the real disk", typeof space.ok === "number" && space.ok > 0, JSON.stringify(space));
  const exists = await call(session, "file_exists", { paths: [process.execPath, join(data, "definitely-missing.mp4")] });
  check("file_exists tells present from missing files", Array.isArray(exists.ok) && exists.ok[0] === true && exists.ok[1] === false, JSON.stringify(exists));
  const refused = await call(session, "open_file", { path: process.execPath });
  check("open_file refuses to launch a program", /audio and video files/.test(refused.err ?? ""), JSON.stringify(refused));
  const badUrl = await call(session, "open_url", { url: "file:///etc/passwd" });
  check("open_url refuses non-web links", !!badUrl.err, JSON.stringify(badUrl));
  const kind = await call(session, "classify_link", { url: "https://www.youtube.com/playlist?list=PL123" });
  check("classify_link recognises a playlist", kind.ok === "playlist", JSON.stringify(kind));

  const infoFiles = await call(session, "file_info", { paths: [process.execPath, join(data, "definitely-missing.mp4")] });
  check("file_info reports size and presence", infoFiles.ok?.[0]?.exists === true && infoFiles.ok[0].size > 1000 && infoFiles.ok[1]?.exists === false, JSON.stringify(infoFiles));
  const exportFile = join(data, "export-test.csv");
  const exported = await call(session, "export_text", { path: exportFile, contents: "a,b\r\n" });
  check("export_text writes a .csv", exported.ok === null && readFileSync(exportFile, "utf8") === "a,b\r\n", JSON.stringify(exported));
  const badExport = await call(session, "export_text", { path: join(data, "evil.exe"), contents: "x" });
  check("export_text refuses other file types", !!badExport.err, JSON.stringify(badExport));
  const badProxy = await call(session, "test_proxy", { proxy: "ftp://nope" });
  check("test_proxy rejects unsupported schemes without connecting", !!badProxy.err, JSON.stringify(badProxy));
  const badSource = await call(session, "search_media", { query: "x", limit: 1, source: "dailymotion", proxy: null });
  check("search_media refuses unverified sources", !!badSource.err, JSON.stringify(badSource));

  if (state === "main") {
    check("the first-run tour opens on a fresh data folder", !!(await session.waitFor("[aria-label='Quick tour']", 8000).catch(() => null)));
    await session.press(Keys.ESCAPE);
    await sleep(500);
    check("Escape skips the tour", !(await session.find("[aria-label='Quick tour']")));
    check("the sidebar has its four sections", (await session.findAll(".sidebar .source")).length === 4);
    check("the title bar has the three window buttons", (await session.findAll(".lights .light")).length === 3);

    const zoom = await session.find(".light.zoom");
    const before = await session.rect();
    await session.click(zoom);
    await sleep(900);
    const after = await session.rect();
    check("the green button maximizes the real window", after.width > before.width || after.height > before.height, `${before.width}x${before.height} -> ${after.width}x${after.height}`);
    await session.click(await session.find(".light.zoom"));
    await sleep(900);
    const restored = await session.rect();
    check("…and restores it", restored.width < after.width || restored.height < after.height, `${after.width}x${after.height} -> ${restored.width}x${restored.height}`);

    await session.press(Keys.F1);
    check("F1 opens the shortcuts sheet in the real webview", !!(await session.waitFor("[aria-label='Keyboard shortcuts']", 5000).catch(() => null)));
    await session.press(Keys.ESCAPE);
    await sleep(300);
    check("Escape closes it", !(await session.find("[aria-label='Keyboard shortcuts']")));

    // Settings page: real engine information
    const buttons = await session.findAll(".sidebar .source");
    await session.click(buttons[3]);
    await session.waitFor("section[aria-label='Download engine']", 5000);
    const engineText = await session.text(await session.find("section[aria-label='Download engine']"));
    check("Settings shows the real yt-dlp version", /\b20\d{2}\.\d{2}\.\d{2}\b/.test(engineText), engineText.replace(/\s+/g, " ").slice(0, 120));

    // Change a setting, then restart the app: it must come back
    const radios = await session.findAll("[aria-label='Interface mode'] button");
    await session.click(radios[1]); // Advanced
    await session.waitFor("section[aria-label='Advanced options']", 5000);
    await sleep(900); // the store autosaves shortly after a change
  }

  await session.quit();
  session = null;
  await sleep(1200);

  if (state === "main") {
    // ---------- second launch with the same data folder ----------
    session = await Session.start(BASE, binary);
    await waitForApp(session);
    await sleep(1500);
    check("the tour is not shown again after a restart", !(await session.find("[aria-label='Quick tour']")));
    const buttons = await session.findAll(".sidebar .source");
    await session.click(buttons[3]);
    await session.waitFor("section[aria-label='Interface']", 5000);
    check("settings survive a restart (the real store file)", !!(await session.waitFor("section[aria-label='Advanced options']", 5000).catch(() => null)));
    const checked = await session.script("return [...document.querySelectorAll(\"[aria-label='Interface mode'] button\")].map((b) => b.getAttribute('aria-checked'))");
    check("Advanced mode is still selected", checked?.[1] === "true", JSON.stringify(checked));

    // ---------- single instance ----------
    const second = spawn(binary, [], { env, stdio: "ignore" });
    const exitCode = await new Promise((resolveExit) => {
      const timer = setTimeout(() => {
        second.kill();
        resolveExit("still running");
      }, 15000);
      second.on("exit", (code) => {
        clearTimeout(timer);
        resolveExit(code);
      });
    });
    check("a second launch hands over to the first and exits", exitCode === 0, String(exitCode));
    check("the first window is still alive afterwards", !!(await session.find(".toolbar")));

    // ---------- closing the window really quits (no downloads running) ----------
    // The app quits as the click lands, so WebDriver may answer with "session terminated": that is the success case.
    let ended = false;
    await session.click(await session.find(".light.close")).catch((e) => {
      ended = /terminated|closed|disconnect|not found/i.test(String(e));
    });
    await sleep(2500);
    ended ||= await fetch(`${BASE}/session/${session.id}/title`).then((r) => !r.ok, () => true);
    check("closing the window ends the app when nothing is downloading", ended);
    session = null;
  }
} catch (e) {
  failed++;
  console.log(` FAIL  ${e.stack ?? e}`);
} finally {
  if (session) await session.quit();
  driver.kill();
  rmSync(data, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
