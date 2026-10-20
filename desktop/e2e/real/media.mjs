#!/usr/bin/env node
// Downloads real files through the built app's real backend and inspects them with ffprobe: tags, cover art,
// audio processing, lyrics and the damaged-file check. Needs the internet, yt-dlp and a full ffmpeg (the fetched build
// in bin/ is used first). Not part of CI.
//
//   npm run test:real:media
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keys, Session } from "./webdriver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const exe = process.platform === "win32" ? ".exe" : "";
const binary = process.env.KAISU_BIN ?? join(root, "desktop", "src-tauri", "target", "release", `desktop${exe}`);
const tools = join(root, "bin");
const ffprobe = join(tools, `ffprobe${exe}`);
const ffmpeg = join(tools, `ffmpeg${exe}`);
for (const p of [binary, ffprobe, ffmpeg]) if (!existsSync(p)) (console.error(`Missing ${p}`), process.exit(2));

/** A free port, so a leftover driver from an earlier run can't be mistaken for this one. */
const PORT = await new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});
const BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "kaisu-media-"));
const out = join(data, "out");
mkdirSync(out);
const env = { ...process.env, PATH: `${tools}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`, XDG_DATA_HOME: join(data, "data"), XDG_CONFIG_HOME: join(data, "config"), APPDATA: join(data, "roaming"), LOCALAPPDATA: join(data, "local") };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "  ok  " : " FAIL "} ${name}${ok ? "" : `  ${extra}`}`); };

const driver = spawn("tauri-driver", ["--port", String(PORT)], { env, stdio: ["ignore", "inherit", "inherit"] });
let driverExited = false;
driver.on("exit", () => (driverExited = true));
for (let i = 0; i < 60 && !driverExited; i++) { try { if ((await fetch(`${BASE}/status`)).ok) break; } catch {} await sleep(250); }
if (driverExited) (console.error("tauri-driver could not start (is the port busy, or is it missing?)"), process.exit(2));

const probe = (file, entries) => JSON.parse(execFileSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" }));
const files = (dir = out) => readdirSync(dir);

const baseExtra = { sponsorblock: "off", cookies_from_browser: null, subs: null, proxy: null, audio_format: "mp3", format_id: null, rate_limit: null, custom_args: null, verbose: false, playlist: null, clip: null, meta: null, cover: null, lyrics: null, audio: null,
  output: { layout: "flat", name: "title", custom: null, playlist_folder: false, playlist_numbering: false } };

let session;
try {
  session = await Session.start(BASE, binary);
  await session.waitFor(".toolbar, .setup-bg", 30000);
  await sleep(1500);
  await session.press(Keys.ESCAPE); // skip the tour

  /** Runs one download through the real backend and returns its events. */
  async function download(id, url, preset, dir, extra) {
    await session.script(
      `window.__ev = window.__ev || {}; window.__ev[arguments[0]] = []; window.__fin = window.__fin || {}; delete window.__fin[arguments[0]];
       const cb = window.__TAURI_INTERNALS__.transformCallback((m) => window.__ev[arguments[0]].push(m));
       window.__TAURI_INTERNALS__.invoke("start_download", { req: arguments[1], onEvent: "__CHANNEL__:" + cb }).then(() => (window.__fin[arguments[0]] = "ok"), (e) => (window.__fin[arguments[0]] = String(e)));`,
      [id, { id, url, preset, out_dir: dir, extra }],
    );
    for (let i = 0; i < 240; i++) {
      const fin = await session.script("return window.__fin[arguments[0]];", [id]);
      if (fin) {
        const raw = await session.script("return window.__ev[arguments[0]];", [id]);
        const events = raw.map((e) => e.message ?? e).filter((e) => e && e.kind);
        return { result: fin, events };
      }
      await sleep(500);
    }
    throw new Error(`${id} did not finish`);
  }
  const ev = (r, kind) => r.events.filter((e) => e.kind === kind);

  // 1. Audio with typed tags, a square cover, a bitrate and loudness normalisation.
  const A = join(out, "a");
  const r1 = await download("a", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "audio", A, {
    ...baseExtra,
    meta: { title: "Zoo: 100% Test", artist: "Jawed", album: "The Zoo", year: "2005", track: "7" },
    cover: { mode: "square", path: null },
    audio: { quality: "128K", normalize: true, trim_silence: false },
  });
  check("audio download finished", r1.result === "ok" && ev(r1, "done").length === 1, JSON.stringify(r1.events.slice(-3)));
  const mp3 = files(A).find((f) => f.endsWith(".mp3"));
  check("an .mp3 was written", !!mp3, files(A).join(", "));
  if (mp3) {
    const p = probe(join(A, mp3));
    const tags = p.format.tags ?? {};
    check("typed title (with a colon and a percent sign) is in the tags", tags.title === "Zoo: 100% Test", JSON.stringify(tags));
    check("artist, album, year and track are in the tags", tags.artist === "Jawed" && tags.album === "The Zoo" && /^2005/.test(tags.date ?? tags.TDRC ?? tags.year ?? "") && String(tags.track).startsWith("7"), JSON.stringify(tags));
    const pic = p.streams.find((s) => s.codec_type === "video");
    check("the cover art is square", !!pic && pic.width === pic.height && pic.width > 100, JSON.stringify(pic && [pic.width, pic.height]));
    check("the bitrate is about 128 kbps", Math.abs(Number(p.format.bit_rate) - 128000) < 20000, p.format.bit_rate);
    const checkedEv = ev(r1, "checked");
    check("the finished file was checked and passed", checkedEv.length === 1 && checkedEv[0].ok === true, JSON.stringify(checkedEv));
  }

  // 2. Audio with the user's own picture (a 200x100 PNG made for the test).
  const png = join(data, "cover.png");
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=200x100", "-frames:v", "1", png]);
  const B = join(out, "b");
  const r2 = await download("b", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "audio", B, { ...baseExtra, cover: { mode: "custom", path: png } });
  const mp3b = files(B).find((f) => f.endsWith(".mp3"));
  check("custom cover: download finished", r2.result === "ok" && !!mp3b, JSON.stringify(r2.events.slice(-3)));
  if (mp3b) {
    const pic = probe(join(B, mp3b)).streams.find((s) => s.codec_type === "video");
    check("custom cover: the picture is on the song, at its own size", !!pic && pic.width === 200 && pic.height === 100, JSON.stringify(pic && [pic.codec_name, pic.width, pic.height]));
    check("custom cover: the log says so", r2.events.some((e) => e.kind === "log" && /Added your cover art/.test(e.line)));
  }
  const r2b = await download("b2", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "audio", join(out, "b2"), { ...baseExtra, cover: { mode: "custom", path: join(data, "missing.png") } });
  check("custom cover: a missing picture stops the download before it starts", r2b.result !== "ok" && /cover image can't be found/.test(r2b.result), r2b.result);

  // 3. No cover at all.
  const C = join(out, "c");
  await download("c", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "audio", C, { ...baseExtra, cover: { mode: "none", path: null } });
  const mp3c = files(C).find((f) => f.endsWith(".mp3"));
  check("no cover: the song has no picture", !!mp3c && !probe(join(C, mp3c)).streams.some((s) => s.codec_type === "video"));

  // 4. A clip as video with a typed title; the length check uses the clip's length.
  const D = join(out, "d");
  const r4 = await download("d", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "best", D, { ...baseExtra, clip: { start: 5, end: 12, precise: false }, meta: { title: "Clip title" } });
  const vid = files(D).find((f) => /\.(mp4|mkv|webm)$/.test(f));
  check("clip: finished and checked ok", r4.result === "ok" && ev(r4, "checked")[0]?.ok === true, JSON.stringify(ev(r4, "checked")));
  if (vid) check("clip: the typed title is in the video", (probe(join(D, vid)).format.tags?.title ?? probe(join(D, vid)).format.tags?.TITLE) === "Clip title", JSON.stringify(probe(join(D, vid)).format.tags));

  // 5. Lyrics from LRCLIB for a well-known song.
  const E = join(out, "e");
  const r5 = await download("e", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "audio", E, { ...baseExtra, lyrics: "both", audio: { quality: "96K", normalize: false, trim_silence: false } });
  const logs = r5.events.filter((e) => e.kind === "log" && /Lyrics|lyrics/.test(e.line)).map((e) => e.line);
  const lrc = files(E).find((f) => f.endsWith(".lrc") || f.endsWith(".txt"));
  check("lyrics: the download itself finished", r5.result === "ok", JSON.stringify(r5.events.slice(-3)));
  check("lyrics: a lyrics file was saved (needs the LRCLIB service)", !!lrc, logs.join(" | "));
  const mp3e = files(E).find((f) => f.endsWith(".mp3"));
  if (mp3e && lrc) {
    const tags = probe(join(E, mp3e)).format.tags ?? {};
    check("lyrics: also inside the song", Object.keys(tags).some((k) => /lyrics|uslt/i.test(k)) , JSON.stringify(Object.keys(tags)));
  }

  await session.quit();
  session = null;
} catch (e) {
  failed++;
  console.log(` FAIL  ${e.stack ?? e}`);
} finally {
  if (session) await session.quit().catch(() => {});
  driver.kill();
  rmSync(data, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
