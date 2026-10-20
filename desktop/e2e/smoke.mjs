#!/usr/bin/env node
// Launches the built app and checks it stays up: the cheapest real-window check, used where the WebDriver suite can't
// run (Windows CI). A second copy must hand over to the first and exit.
//
//   node e2e/smoke.mjs [path-to-exe]
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exeName = process.platform === "win32" ? "desktop.exe" : "desktop";
const exe = resolve(process.argv[2] ?? join(here, "..", "src-tauri", "target", "release", exeName));
if (!existsSync(exe)) {
  console.error(`No app at ${exe}. Build it first: npm run build:exe`);
  process.exit(2);
}

// Keep the run away from real settings.
const data = mkdtempSync(join(tmpdir(), "kaisu-smoke-"));
const env = { ...process.env, APPDATA: data, LOCALAPPDATA: data, XDG_DATA_HOME: data, XDG_CONFIG_HOME: data, XDG_CACHE_HOME: data };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
};

const first = spawn(exe, [], { env, stdio: "ignore" });
let firstExit = null;
first.on("exit", (code) => (firstExit = code ?? "signal"));
await sleep(8000);
check("the app starts and keeps running", firstExit === null);

const second = spawn(exe, [], { env, stdio: "ignore" });
let secondExit = null;
second.on("exit", (code) => (secondExit = code ?? "signal"));
await sleep(5000);
check("a second copy exits instead of opening another window", secondExit !== null);
check("the first copy is still running", firstExit === null);

for (const child of [first, second]) if (child.exitCode === null) child.kill();
await sleep(500);
rmSync(data, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "smoke test passed");
process.exit(failed ? 1 : 0);
