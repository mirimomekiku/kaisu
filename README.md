# Kaisu

A video downloader built on [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg, as a
**desktop app** (Tauri v2 + React, Linux and Windows) and a **terminal UI** (Python + Textual).

```
kaisu/
├── scripts/fetch-binaries.mjs   # downloads yt-dlp + static LGPL ffmpeg/ffprobe
├── bin/                         # fetched binaries for the TUI (git-ignored) + VERSIONS.json
├── desktop/                     # Tauri app
│   ├── src/                     # React UI (App.tsx, hooks/, components/, lib/)
│   └── src-tauri/src/           # Rust: engine.rs (sidecars + updater), download.rs, proc.rs
└── tui/                         # Textual app (app.py, main.py)
```

## Using it

**Desktop app (installers):** just open it. On first launch Kaisu checks for its helper tools and, if
anything is missing, shows a one-click **Set up automatically** screen (see below).

**Terminal app:** run `tui/run-tui.sh` (Linux) or `tui/run-tui.cmd` (Windows). If `uv` isn't installed the
launcher offers to install it; uv then fetches Python 3.11+ and every dependency. On first start the app offers
to download any missing helper tools.

## Helper tools and automatic setup

Kaisu needs three things besides itself. All are looked up in this order: bundled with the app, then the
app's own folder, then your `PATH`.

| Tool | What it's for | Installed by Setup |
| --- | --- | --- |
| **yt-dlp** | finds and downloads the video | yes (desktop; the TUI gets it from pip) |
| **ffmpeg + ffprobe** | joins video and audio, converts to MP3 | yes (static LGPL build) |
| **Deno** (or node / bun) | lets yt-dlp read YouTube; without it some formats go missing | yes |

Setup detects your OS and CPU and downloads the matching build from the official project releases
(Linux x86_64/aarch64, Windows x86_64). Every download is checked against the publisher's SHA-256 and test-run
before use, and nothing is installed system-wide: files go to `~/.local/share/com.kaisu.app/engine` on Linux or
`%APPDATA%\com.kaisu.app\engine` on Windows. The desktop app and the TUI share that folder.
On other platforms, or if a download fails, Setup shows copy-paste install commands matched to your OS / distro
(`winget ...`, `dnf` / `apt` / `pacman` ...). **Settings > Repair** (desktop) or **F1** (TUI) re-runs it any time.

## Building from source

Run the checker first; it tells you exactly what's missing on your machine and how to install it:

```bash
node scripts/doctor.mjs          # add --fix to also download the yt-dlp / ffmpeg sidecars
node scripts/fetch-binaries.mjs  # or fetch the sidecars on their own (--force to refresh)
```

The fetch script writes the Tauri sidecars to `desktop/src-tauri/bin/` and a copy to `bin/` for the TUI.

## Desktop app

Prerequisites (`node scripts/doctor.mjs` checks all of these): Node 20+, Rust stable, and
- **Linux:** WebKitGTK 4.1, librsvg and OpenSSL dev packages (e.g. Fedora `sudo dnf install webkit2gtk4.1-devel librsvg2-devel openssl-devel`, Debian/Ubuntu `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev`)
- **Windows:** the MSVC C++ build tools and WebView2 (preinstalled on Windows 11)

```bash
cd desktop
npm install
npm run tauri dev       # development
npm run tauri build     # installers: .exe (NSIS) on Windows, .deb / .AppImage on Linux
```

### Simple and Advanced modes

A switch in the header changes how much of the app you see (your choice is remembered).

- **Simple** (default, for non-technical users): paste a link and Kaisu looks it up automatically. Choose Video or
  Audio, optionally a smaller 720p file, and press Download. Errors are explained in plain language ("This video needs
  you to be signed in") with the raw output behind a "Technical details" link. Settings shows only the download folder
  and updates.
- **Advanced**: everything above plus an exact stream picker (video and audio formats from the real format list),
  1080p / audio format (MP3, M4A, Opus, FLAC, WAV), speed limit, SponsorBlock, subtitles, cookies-from-browser,
  parallel download count, a per-download log, the engine versions and locations, and a field for your own yt-dlp
  arguments. Advanced settings never leak into Simple mode.

Both modes: queue with progress/speed/ETA, cancel and retry, history with "show in folder", and a configurable
download folder.

### How the engine works

- yt-dlp, ffmpeg and ffprobe are Tauri sidecars, installed next to the app executable.
- The frontend never builds command lines. It sends a typed request; `download.rs` builds the arguments from an
  allowlist, passes the URL after `--`, and rejects anything that isn't an `http(s)` link. The one free-form input
  is Advanced mode's custom-arguments field, which is validated: options that run programs (`--exec`,
  `--netrc-cmd`, `--plugin-dirs`, ...) are blocked, including abbreviated spellings.
- **Auto-update:** at launch (at most every 6 hours, can be turned off in Settings) the app checks GitHub for a newer
  yt-dlp, verifies its SHA-256, test-runs it, and installs it into the app data dir (`<app data>/engine/`). Whichever
  of the bundled and updated copies is newer is used, so a fresh app release never regresses to an older engine.
  Updates are refused while downloads are running.
- Cancel kills the whole process tree (`taskkill /T` on Windows, process-group kill on Unix), because yt-dlp's
  one-file builds spawn child processes.

## Terminal UI

```bash
cd tui
uv run python main.py [--out ~/Videos]
```

Or use `tui/run-tui.sh` / `tui/run-tui.cmd`, which install uv for you if needed. Requires Python 3.11+ (uv fetches it).
`Enter`/`F2` inspect, `F5` download, `Esc` cancel, `F6` clear log, `F1` setup, `Ctrl+Q` quit.
Downloads go to `--out`, `$KAISU_OUT`, or `~/Downloads`.

The TUI uses the `yt-dlp` Python package, pinned in `tui/pyproject.toml` to the version in `bin/VERSIONS.json`
(with the `[default]` extra, which provides the YouTube challenge solver the standalone binary bundles) so both apps
behave the same. When you refresh binaries, bump that pin. It does not auto-update.
It uses the same presets and format selectors as the desktop app and the ffmpeg from `bin/` (or `PATH`).

## CI

`.github/workflows/build.yml` builds Linux and Windows bundles, runs the Rust tests, and runs the TUI's offline tests on both OSes on every push. Windows
installers are unsigned, so SmartScreen will warn until you add a code-signing certificate.

## Licensing note

The fetched ffmpeg is the LGPL build (no GPL or non-free codecs such as x264 or fdk-aac). MP3 output uses libmp3lame,
which is included. If you redistribute the app, include the ffmpeg and yt-dlp license texts.
