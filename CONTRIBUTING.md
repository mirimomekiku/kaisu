# Building and testing Kaisu

```
kaisu/
├── scripts/            # doctor.mjs (checks your machine), fetch-binaries.mjs (tools for the terminal app)
├── bin/                # fetched yt-dlp / ffmpeg for the terminal app (git-ignored)
├── desktop/            # Tauri v2 app
│   ├── src/            # React UI (App.tsx, hooks/, components/, lib/)
│   ├── src-tauri/src/  # Rust: engine, download, subs, net, search, links, files, tray, proc
│   └── e2e/            # UI tests, real-window tests, smoke test
└── tui/                # Textual terminal app
```

## Set up

```bash
node scripts/doctor.mjs        # tells you what is missing; add --fix to fetch tools for the terminal app
cd desktop && npm install
npm run tauri dev              # run in development
npm run build:exe              # one executable: src-tauri/target/release/desktop(.exe), no installer
```

Needs Node 20+, Rust stable, and on Linux the WebKitGTK 4.1, librsvg and OpenSSL dev packages (Windows: MSVC build
tools and WebView2).

## Tests

```bash
cd desktop
npm test                         # unit tests (vitest)
cd src-tauri && cargo test       # Rust tests
cd .. && npm run test:ui         # UI tests: the real React app in Chrome with the Tauri side scripted
npm run build:exe && npm run test:real   # drives the built app's real window (Linux; needs tauri-driver)
npm run test:smoke               # launches the built exe and checks it stays up
npm run test:real:audit          # offline native checks for destination scope, transfer companions and cache relocation
npm run test:real:playback       # real WAV/MP3/M4A/FLAC/Opus playback, seek, range and authorization checks (needs bin/ffmpeg)
```

`test:ui` needs Chrome (or `KAISU_E2E_BROWSER=/path/to/chrome`). `test:real` needs `cargo install tauri-driver
--locked`, `webkit2gtk-driver` and a display (`xvfb-run -a` on servers). Terminal app: `cd tui && uv run python -m unittest`.

Podcasts are retained behind `VITE_ENABLE_PODCASTS=true`; the default build hides their UI and pauses background checks.
Use the same environment variable with `npm run test:ui -- round12` to run the retained subscription/download regression suite.
Without it, round12 checks the hidden/paused state. `round13` covers imported music, polling, relocation, smart playlists,
duplicate review and the mini-player through the browser backend mock. Native choosers, file hashes/deletion and window
geometry still require Rust tests and a real Tauri run on a machine whose application policy permits them.
On Linux, `dbus-run-session -- npm run test:real:audit` isolates the test from an existing Kaisu instance. The audit
runner defaults to the debug executable; set `KAISU_BIN` to test a different build. Its generated WAV files and app data
are temporary, and it does not install helper tools or contact media websites.
`round14` covers favorites/ratings, listening statistics and recycle/permanent removal choices. Windows recycling uses
a guarded native shell operation; other platforms use the `trash` crate. Never fall back to permanent removal on a recycling error.

## How it fits together

- The frontend never builds command lines. It sends typed requests; `download.rs` builds yt-dlp arguments from an
  allowlist, passes the URL after `--`, and accepts only http(s) links. Custom arguments are validated, and options
  that run programs are blocked.
- The desktop app downloads yt-dlp, ffmpeg and a JS runtime on first run into the app data folder
  (`~/.local/share/com.kaisu.app/engine` or `%APPDATA%\com.kaisu.app\engine`), verified by SHA-256.
- Custom yt-dlp arguments (`custom_args.rs`) are checked against an allowlist, not a denylist. The table of options and
  how many values each takes was generated from yt-dlp's own parser (`yt_dlp.options.create_parser()`), so check a new
  option the same way before adding it. Never add options that run programs, take a file path, or change where tools are found.
- The folders Kaisu may move files out of, move them into, and delete from are held by the backend (`scope.rs`), not sent
  with each request. Playing a file in the app also goes through it (`media.rs`).
- Site-rule destinations persist in backend-owned `download-folders.json`. They grant library and explicit media actions;
  automatic transfer and cleanup still use only the primary download/moved roots. Active rule folders cannot be removed
  from Music folders until the rule is changed. Older destinations remain available for explicit removal from the library.
- Track relocation is coordinated at app level, including playlists while the Library page is closed. `round16` covers
  queue credential migration, delayed startup loads, automatic moves/copies/failures and site-rule folder lifecycle.
- `round17` covers song multi-selection, keyboard and modifier ranges across virtual rows, filtered selections,
  bulk preferences/playlists/playback/tag edits, partial tag failures, missing files and the minimum window size.
- `round18` covers dropdown keyboard behavior, settings sections/search, modal focus and minimum-window layouts in all themes.
- Playback URLs come from `play_in_app`: an ephemeral loopback server streams explicitly authorized media in bounded chunks,
  with HTTP byte ranges for seeking. Random capability URLs expose no filesystem paths, bind only to 127.0.0.1,
  validate Host, and recheck current folder scope on every request. The webview asset protocol remains for previews.
- `round19` verifies native select sizing and Downloads/History context menus in every layout. `round20` covers the full-screen
  player, shared audio/transport, native-window lifecycle, focus, lyrics/consent and stale lookup results.
- The proxy is passed explicitly to every yt-dlp call and to the setup downloads.
- Search sources are a short list in `search.rs` and `lib/sources.ts`; add one only after checking it returns results.

## Releases

There is no CI: releases are built on a developer machine. Versions are 0.0.x until the project declares 1.0.0.

1. Bump the version in `desktop/package.json`, `desktop/src-tauri/tauri.conf.json` and `desktop/src-tauri/Cargo.toml` (including their lockfiles), and commit.
2. Build the Windows executable (works from Linux too, using `cargo-xwin`):

   ```bash
   rustup target add x86_64-pc-windows-msvc
   cargo install --locked cargo-xwin     # needs clang, lld and llvm-rc on PATH
   cd desktop && npm run build:exe:windows
   ```

   The result is `desktop/src-tauri/target/x86_64-pc-windows-msvc/release/desktop.exe`.
3. Tag and publish: `git tag v0.0.3 && git push origin v0.0.3`, then
   `gh release create v0.0.3 desktop/src-tauri/target/x86_64-pc-windows-msvc/release/desktop.exe#kaisu-windows-x64.exe --prerelease --generate-notes`.
