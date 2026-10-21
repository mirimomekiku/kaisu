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
```

`test:ui` needs Chrome (or `KAISU_E2E_BROWSER=/path/to/chrome`). `test:real` needs `cargo install tauri-driver
--locked`, `webkit2gtk-driver` and a display (`xvfb-run -a` on servers). Terminal app: `cd tui && uv run python -m unittest`.

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
- The proxy is passed explicitly to every yt-dlp call and to the setup downloads.
- Search sources are a short list in `search.rs` and `lib/sources.ts`; add one only after checking it returns results.

## Releases

There is no CI: releases are built on a developer machine. Versions are 0.0.x until the project declares 1.0.0.

1. Bump the version in `desktop/package.json`, `desktop/src-tauri/tauri.conf.json` and `desktop/src-tauri/Cargo.toml`, and commit.
2. Build the Windows executable (works from Linux too, using `cargo-xwin`):

   ```bash
   rustup target add x86_64-pc-windows-msvc
   cargo install --locked cargo-xwin     # needs clang, lld and llvm-rc on PATH
   cd desktop && npm run build:exe:windows
   ```

   The result is `desktop/src-tauri/target/x86_64-pc-windows-msvc/release/desktop.exe`.
3. Tag and publish: `git tag v0.0.2 && git push origin v0.0.2`, then
   `gh release create v0.0.2 desktop/src-tauri/target/x86_64-pc-windows-msvc/release/desktop.exe#kaisu-windows-x64.exe --prerelease --generate-notes`.
