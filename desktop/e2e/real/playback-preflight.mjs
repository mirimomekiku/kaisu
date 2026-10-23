import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const nativeReport = process.env.KAISU_NATIVE_REPORT ?? join(desktop, "src-tauri/target/playback-report.json");
export function writeNativeReport(status, checks, details = []) {
  mkdirSync(dirname(nativeReport), { recursive: true });
  writeFileSync(nativeReport, JSON.stringify({ at: new Date().toISOString(), platform: process.platform, status, checks, details }, null, 2));
}
function executable(name) {
  const names = process.platform === "win32" ? [name + ".exe", name] : [name];
  return (process.env.PATH ?? "").split(delimiter).flatMap((dir) => names.map((n) => join(dir, n))).find((path) => existsSync(path));
}
function newest(dir) {
  if (!existsSync(dir)) return 0;
  return Math.max(0, ...readdirSync(dir, { withFileTypes: true }).map((entry) => entry.isDirectory() ? newest(join(dir, entry.name)) : statSync(join(dir, entry.name)).mtimeMs));
}
export function playbackPrerequisites(binary) {
  const problems = [];
  const driver = process.env.KAISU_TAURI_DRIVER || executable("tauri-driver");
  const nativeDriver = process.env.KAISU_NATIVE_DRIVER || (process.platform === "win32" ? executable("msedgedriver") : undefined);
  const bundled = resolve(desktop, `../bin/ffmpeg${process.platform === "win32" ? ".exe" : ""}`);
  const ffmpeg = process.env.KAISU_FFMPEG || (existsSync(bundled) ? bundled : executable("ffmpeg"));
  if (!existsSync(binary)) problems.push("Build the native app: npm run tauri -- build --debug --no-bundle");
  else if (statSync(binary).mtimeMs < Math.max(newest(join(desktop, "src")), newest(join(desktop, "src-tauri/src")) )) problems.push("The native executable is older than the source. Rebuild it before validating playback.");
  if (!driver || !existsSync(driver)) problems.push("tauri-driver is missing. Install it with cargo install tauri-driver --locked, or set KAISU_TAURI_DRIVER.");
  if (process.platform === "win32" && (!nativeDriver || !existsSync(nativeDriver))) problems.push("Windows requires a matching Edge WebDriver. Put msedgedriver.exe on PATH or set KAISU_NATIVE_DRIVER.");
  if (!ffmpeg || !existsSync(ffmpeg)) problems.push("ffmpeg is missing. Set KAISU_FFMPEG or provide bin/ffmpeg for temporary test media generation.");
  if (problems.length) { writeNativeReport("blocked", 0, problems); throw new Error("Native playback validation is blocked:\n- " + problems.join("\n- ") + `\nReport: ${nativeReport}`); }
  return { driver, nativeDriver, ffmpeg };
}
