#!/usr/bin/env node
// Checks that this machine can build and run Kaisu from source, and tells you exactly how to fix
// anything that's missing. Works on Linux and Windows.
//
//   node scripts/doctor.mjs          report only
//   node scripts/doctor.mjs --fix    also download the yt-dlp / ffmpeg sidecars if they're missing
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const fix = process.argv.includes("--fix");

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: win }).trim();
  } catch {
    return null;
  }
};

function distroIds() {
  try {
    const ids = [];
    for (const line of readFileSync("/etc/os-release", "utf8").split("\n")) {
      const [k, v = ""] = line.split("=");
      const value = v.replace(/"/g, "").toLowerCase();
      if (k === "ID") ids.unshift(value);
      if (k === "ID_LIKE") ids.push(...value.split(/\s+/));
    }
    return ids;
  } catch {
    return [];
  }
}

function linuxPackages() {
  const ids = distroIds();
  const is = (...n) => n.some((x) => ids.includes(x));
  if (is("fedora", "rhel", "centos")) return "sudo dnf install webkit2gtk4.1-devel librsvg2-devel openssl-devel gcc";
  if (is("debian", "ubuntu")) return "sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev build-essential";
  if (is("arch")) return "sudo pacman -S webkit2gtk-4.1 librsvg openssl base-devel";
  if (is("suse", "opensuse")) return "sudo zypper install webkit2gtk3-devel librsvg-devel libopenssl-devel gcc";
  return "Install the WebKitGTK 4.1, librsvg and OpenSSL development packages for your distribution.";
}

const triple = run("rustc", ["-vV"])?.match(/host: (\S+)/)?.[1];
const ext = win ? ".exe" : "";
const sidecar = (n) => existsSync(join(ROOT, "desktop", "src-tauri", "bin", `${n}-${triple}${ext}`));

const checks = [];
const add = (name, ok, detail, fixHint) => checks.push({ name, ok, detail, fixHint });

const nodeMajor = Number(process.versions.node.split(".")[0]);
add("Node.js 20+", nodeMajor >= 20, `v${process.versions.node}`, "Install Node.js LTS from https://nodejs.org");
add("npm", !!run("npm", ["--version"]), run("npm", ["--version"]) ?? "not found", "npm ships with Node.js");

const rustc = run("rustc", ["--version"]);
add(
  "Rust toolchain",
  !!rustc,
  rustc ?? "not found",
  win ? "winget install Rustlang.Rustup   (then reopen your terminal)" : "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
);

if (win) {
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  const vs = existsSync(vswhere) ? run(`"${vswhere}"`, ["-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"]) : null;
  add("MSVC C++ build tools", !!vs, vs || "not found", "winget install Microsoft.VisualStudio.2022.BuildTools --override \"--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\"");
  const webview = run("reg", ["query", "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", "/v", "pv"]);
  add("WebView2 runtime", !!webview, webview ? "installed" : "not found (preinstalled on Windows 11)", "winget install Microsoft.EdgeWebView2Runtime");
} else if (process.platform === "linux") {
  const pc = (lib) => run("pkg-config", ["--exists", lib]) !== null && spawnSync("pkg-config", ["--exists", lib]).status === 0;
  const libs = ["webkit2gtk-4.1", "librsvg-2.0", "openssl"];
  const missing = libs.filter((l) => !pc(l));
  add("System libraries (WebKitGTK, librsvg, OpenSSL)", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "all found", linuxPackages());
  add("C compiler", !!(run("cc", ["--version"]) ?? run("gcc", ["--version"])), "needed to build native dependencies", linuxPackages());
}

add("uv (only for the terminal app)", !!run("uv", ["--version"]), run("uv", ["--version"]) ?? "not found, tui/run-tui.* installs it for you", win ? "winget install --id=astral-sh.uv -e" : "curl -LsSf https://astral.sh/uv/install.sh | sh");

const haveSidecars = triple && ["yt-dlp", "ffmpeg", "ffprobe"].every(sidecar);
add("Sidecar binaries (yt-dlp, ffmpeg)", !!haveSidecars, haveSidecars ? "present" : "not downloaded yet", "node scripts/fetch-binaries.mjs");

console.log(`Kaisu doctor: ${win ? "Windows" : process.platform} ${process.arch}${triple ? ` (${triple})` : ""}\n`);
for (const c of checks) {
  console.log(`${c.ok ? "  ok " : " MISSING"}  ${c.name}  -  ${c.detail}`);
  if (!c.ok) console.log(`          fix: ${c.fixHint}`);
}

if (fix && !haveSidecars && triple) {
  console.log("\nDownloading sidecar binaries...");
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "fetch-binaries.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exitCode = 1;
}

const blocking = checks.filter((c) => !c.ok && !c.name.startsWith("uv"));
if (blocking.length) {
  console.log(`\n${blocking.length} thing(s) to fix before 'npm run tauri dev' will work.`);
  process.exitCode = 1;
} else {
  console.log("\nAll set. Next: cd desktop && npm install && npm run tauri dev");
}
