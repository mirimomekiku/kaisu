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

### Search and video details

Type anything that isn't a link into the box and press **Enter** to search YouTube (12 results at a time, with
**Show more results**). Pick a result, or paste a link, and a details card shows the thumbnail, title, channel,
duration, views, likes, upload date and description, plus a clear **Video** / **Audio only** choice with approximate
file sizes. Live streams are flagged. Search uses yt-dlp's flat `ytsearch` mode, so results arrive in a few seconds.

### Look and layout

The desktop app is styled after Mac OS X's Aqua era and iTunes 10: a silver toolbar, a blue-grey **source list** on the
left (Search, Downloads, History, Settings, with the current video's artwork at the bottom), striped list tables, gel
buttons, candy-stripe progress bars and a status bar along the bottom. The recessed **display** in the middle of the
toolbar shows what Kaisu is doing right now (searching, or the active download with speed, time left and progress), and
the rounded field on the right is the single place to search YouTube or paste a link. The look lives in one stylesheet,
`desktop/src/App.css`.

- **Font:** [Work Sans](https://fonts.google.com/specimen/Work+Sans) from Google Fonts, bundled with the app (via
  `@fontsource-variable/work-sans`) so it works offline and under the app's strict content-security policy.
- **Window frame:** the OS title bar is turned off. Kaisu draws its own red/yellow/green window buttons in the toolbar
  (they grey out when the window is inactive), and the toolbar is the drag handle (double-click maximizes). Windows and
  Linux get the same Mac-style buttons on the left.
- **Cursors:** a pointing hand on anything clickable, a text cursor in text fields, and a "not allowed" cursor on
  disabled controls.

### Playlists, channels and several links

- Paste a **playlist** or **channel** link (or choose "View playlist" on a video that belongs to one) and Kaisu lists
  its videos: up to 200 at first, with "Show more" up to 500. Use **Download all N videos** or tick the ones you want.
  Items are saved in a folder named after the playlist and numbered (`04 - Title.mp4`) so they stay in order. Both
  can be turned off in Settings.
- Paste or drop **several links** at once and they appear as a ticked list, ready to download together.

### Safe, resumable downloads

- **Pause and resume** any download (or all of them, from the status bar or the tray menu). Partial files are kept, so
  resuming carries on rather than starting over.
- **Restarts are safe.** The queue is saved; after a restart, anything unfinished comes back *paused* with a banner
  offering **Resume** or **Remove them**. Nothing starts by surprise.
- **No accidental repeats.** Downloading something you already have (and whose file still exists) asks first: open the
  file, download again, or skip. In a batch you can skip just the duplicates. The same download is never queued twice.
- **Disk space.** Kaisu warns below 2 GB free, and refuses to start below 200 MB rather than fail half-way.

### Download part of a video

Open **Download only part of this video** on the details card, type a start and end (`1:20`, `1:02:30`), and only that
section is downloaded, as video or audio. Cuts land on the nearest keyframe by default; tick **Cut exactly** to
re-encode for frame-accurate edges. Clips get `[clip 1m20s-2m45s]` in their file name and are tracked separately from the
full video.

### Organising your files

Settings, Downloads: choose a folder layout (all in one folder, a folder per channel, separate Video and Audio folders,
or a folder per upload year) and a file-name style (`Title [id]`, `Title`, `Channel - Title`, `Date - Title`), with a
live example of the resulting path. Advanced mode adds a custom template (`%(channel)s/%(upload_date>%Y)s/%(title)s`).
Templates are validated: they must stay inside the download folder (no `..`, no absolute paths) and use legal
file-name characters.

### Notifications, background and the tray

- A **notification** appears when a batch finishes while Kaisu isn't the focused window (one per batch, not per file).
- **When done** (Downloads page): open the folder, quit Kaisu, or sleep / shut down the computer. Sleep and shut down
  show a 30-second cancellable countdown. It applies once, then resets, and is never remembered between launches.
- **Closing the window** can keep downloads going from the **tray icon** (default: only while something is
  downloading, and Kaisu quits by itself once they finish). The tray menu has Show, Pause all, Resume all and Quit.
  Launching Kaisu again just brings the running window back. If your desktop has no tray (stock GNOME needs the
  AppIndicator extension), closing the window quits and unfinished downloads resume next time.

### Clipboard and drag and drop

- **Drop a link** (or several) from a browser onto the window to look it up.
- **Copied links.** When you copy a link from a well-known site (YouTube, Vimeo, SoundCloud, TikTok and similar),
  Kaisu offers to look it up the next time you switch to it. It only reads the clipboard while its window is focused,
  never sends it anywhere, and can be turned off in Settings.

### Keyboard shortcuts

Press **F1** (or Ctrl+/) for the full list. Highlights: Ctrl+F / L / K focus search, Ctrl+1 to 4 switch pages, Ctrl+A
selects all results, Ctrl+D downloads the open video (add Shift for audio), Ctrl+Shift+P pauses or resumes everything,
Ctrl+O opens the download folder, and Esc clears the selection. Shortcuts pause while a dialog or menu is open.

### Downloaded files, history and views

- **Open what you downloaded:** finished downloads, the history and the details card all have **Open** (plays the file
  in your default app) and **Show in folder**. If a file was moved or deleted, Kaisu says so instead of failing.
  Only real audio/video files can be opened this way.
- **No clutter for videos you already have:** if a video is in your history, its details card lists the existing files
  with Open buttons and tucks "What would you like to download?" away behind **Download again**. The choice also
  collapses once you start a download. History rows have the same **Download again** dropdown.
- **Right-click menu on search results:** show details, download as video / 720p / audio, select, open or reveal the file
  if you already have it, open in the browser, copy the link or title, or search for the channel. With several results
  ticked it downloads them all. Works in every layout, and from the keyboard with the Menu key or Shift+F10.
- **Select several results:** in YouTube search, tick the checkboxes (or **Select all**) and use the bar that appears to
  download all of them as video or audio at once. Clicking a result's title still opens its details.
- **Layouts:** search results, the download queue and the history can each be shown as a **details table** (the
  default), **list** with artwork, **grid** or **compact** rows. Switch with the buttons at the top left; each page
  remembers its choice. History also has a title filter and a
  Video/Audio filter.
- **Settings is its own page** (in the sidebar), with the Simple/Advanced switch, download folder, advanced options and the engine tools.

### Simple and Advanced modes

Choose the mode on the **Settings** page (your choice is remembered).

- **Simple** (default, for non-technical users): paste a link and Kaisu looks it up automatically, or type words and
  press Enter to search YouTube. Choose Video or Audio, optionally a smaller 720p file, and press Download. Errors are explained in plain language ("This video needs
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
Type words and press `Enter` to search YouTube (pick a result with the arrow keys and `Enter`), or paste a link and
press `Enter`/`F2` to see its details. Then choose Video or Audio and press `F5` to download. `Esc` cancels, `F6`
clears the log, `F1` runs setup, `Ctrl+Q` quits.
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
