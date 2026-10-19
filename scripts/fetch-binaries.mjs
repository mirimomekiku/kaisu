#!/usr/bin/env node
// Downloads yt-dlp + static LGPL ffmpeg/ffprobe for the Tauri sidecars and the TUI.
//
//   node scripts/fetch-binaries.mjs [--target <triple>] [--force]
//
// Outputs:
//   desktop/src-tauri/bin/<name>-<triple>[.exe]   (Tauri externalBin sidecars)
//   bin/<name>[.exe]                              (host triple only, used by the TUI)
//   bin/VERSIONS.json
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR_DIR = join(ROOT, "desktop", "src-tauri", "bin");
const SHARED_DIR = join(ROOT, "bin");

const args = process.argv.slice(2);
const force = args.includes("--force");
const targetIdx = args.indexOf("--target");
const hostTriple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/host: (\S+)/)[1];
const triple = targetIdx >= 0 ? args[targetIdx + 1] : hostTriple;

// Per-target asset names.
const TARGETS = {
  "x86_64-unknown-linux-gnu": { ytdlp: "yt-dlp_linux", ffmpeg: "linux64", archive: "tar.xz", exe: "" },
  "aarch64-unknown-linux-gnu": { ytdlp: "yt-dlp_linux_aarch64", ffmpeg: "linuxarm64", archive: "tar.xz", exe: "" },
  "x86_64-pc-windows-msvc": { ytdlp: "yt-dlp.exe", ffmpeg: "win64", archive: "zip", exe: ".exe" },
};
const cfg = TARGETS[triple];
if (!cfg) {
  console.error(`Unsupported target ${triple}. Supported: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const headers = { "User-Agent": "kaisu-fetch-binaries" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function getJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function getBuffer(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function checksumFor(sums, file) {
  return sums
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, f]) => f === file || f === `*${file}`)?.[0];
}

function install(src, name) {
  mkdirSync(SIDECAR_DIR, { recursive: true });
  const dest = join(SIDECAR_DIR, `${name}-${triple}${cfg.exe}`);
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`  installed ${dest}`);
  if (triple === hostTriple) {
    mkdirSync(SHARED_DIR, { recursive: true });
    const shared = join(SHARED_DIR, `${name}${cfg.exe}`);
    copyFileSync(src, shared);
    chmodSync(shared, 0o755);
  }
}

const versions = {};

// ---- yt-dlp ---------------------------------------------------------------
async function fetchYtDlp() {
  const release = await getJson("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest");
  versions.ytDlp = release.tag_name;
  console.log(`yt-dlp ${release.tag_name} (${cfg.ytdlp})`);

  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${release.tag_name}`;
  const sums = (await getBuffer(`${base}/SHA2-256SUMS`)).toString("utf8");
  const expected = checksumFor(sums, cfg.ytdlp);
  if (!expected) throw new Error(`no checksum for ${cfg.ytdlp}`);

  const buf = await getBuffer(`${base}/${cfg.ytdlp}`);
  if (sha256(buf) !== expected) throw new Error("yt-dlp checksum mismatch");

  const tmp = mkdtempSync(join(tmpdir(), "kaisu-ytdlp-"));
  const file = join(tmp, "yt-dlp");
  writeFileSync(file, buf);
  install(file, "yt-dlp");
  rmSync(tmp, { recursive: true, force: true });
}

// ---- ffmpeg / ffprobe (BtbN LGPL static builds) ----------------------------
function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (entry === name) {
      return p;
    }
  }
  return null;
}

async function fetchFfmpeg() {
  const release = await getJson("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest");
  const assetName = `ffmpeg-master-latest-${cfg.ffmpeg}-lgpl.${cfg.archive}`;
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) throw new Error(`asset ${assetName} not found in BtbN release ${release.tag_name}`);
  console.log(`ffmpeg (LGPL) ${release.tag_name} (${assetName})`);

  const sumsAsset = release.assets.find((a) => a.name === "checksums.sha256");
  if (!sumsAsset) throw new Error("checksums.sha256 missing from BtbN release");
  const expected = checksumFor((await getBuffer(sumsAsset.browser_download_url)).toString("utf8"), assetName);
  if (!expected) throw new Error(`no checksum for ${assetName}`);

  const buf = await getBuffer(asset.browser_download_url);
  if (sha256(buf) !== expected) throw new Error("ffmpeg checksum mismatch");

  const tmp = mkdtempSync(join(tmpdir(), "kaisu-ffmpeg-"));
  const archive = join(tmp, assetName);
  writeFileSync(archive, buf);
  // bsdtar ships with Windows 10+ and handles zip as well as tar.xz.
  // Use the system bsdtar explicitly: Git Bash's GNU tar (earlier on PATH in CI) can't read zips.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xf", archive, "-C", tmp]);
  for (const name of ["ffmpeg", "ffprobe"]) {
    const found = findFile(tmp, `${name}${cfg.exe}`);
    if (!found) throw new Error(`${name} not found in archive`);
    install(found, name);
  }
  versions.ffmpeg = `BtbN ${release.tag_name} (LGPL)`;
  rmSync(tmp, { recursive: true, force: true });
}

const have = (name) => existsSync(join(SIDECAR_DIR, `${name}-${triple}${cfg.exe}`));
console.log(`Target: ${triple}`);
if (force || !have("yt-dlp")) await fetchYtDlp();
else console.log("yt-dlp present (use --force to refresh)");
if (force || !have("ffmpeg") || !have("ffprobe")) await fetchFfmpeg();
else console.log("ffmpeg present (use --force to refresh)");

if (Object.keys(versions).length && triple === hostTriple) {
  const file = join(SHARED_DIR, "VERSIONS.json");
  mkdirSync(SHARED_DIR, { recursive: true });
  let previous = {};
  try {
    previous = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  writeFileSync(file, JSON.stringify({ ...previous, ...versions }, null, 2) + "\n");
}
console.log("Done.", versions);
