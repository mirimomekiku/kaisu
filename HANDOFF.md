# Handoff: where Kaisu stands and what to do next

Written at the end of a long working session so a new session (human or AI) can pick up without the conversation. Read this first,
then `README.md` (what the app does) and `CONTRIBUTING.md` (how to build and test).

Kaisu is a desktop downloader for videos and music (Tauri v2: Rust backend in `desktop/src-tauri`, React 19 + TypeScript frontend in
`desktop/src`), wrapping yt-dlp and ffmpeg. A separate Python terminal app lives in `tui/` and was not touched.

---

## 1. Current state in one paragraph

Everything from the audit and the two improvement rounds is done, tested and pushed. On top of that, a **music player** was started:
steps 1 and 2 of a five-step audio roadmap are done (player bar, queue); **step 3 (the music library) is half done**: the Rust
scanner and the pure TypeScript logic exist and are tested, but **there is no Library page yet** (no sidebar entry, no UI). The
last commit before this document builds on everything below. **The final state was not re-verified end to end** (see section 6).

---

## 2. How to work in this repo (read before running anything)

### The machine this was built on
- **Windows 11, standalone PC, Application Control is on** (AppLocker rules + Smart App Control). Consequences:
  - `winget` is blocked. Rust, MSVC Build Tools (Desktop C++ workload) and Node were installed by hand.
  - AppLocker has an allow rule for `D:\laragon\www\kaisu\*`. Freshly built executables are **sometimes** still refused with
    `os error 4551` ("An Application Control policy has blocked this file"), e.g. `target\debug\desktop.exe` and occasionally the
    `main.rs` test binary. **The real app (`desktop.exe`) has never been launched in this environment.** Everything Rust is
    verified through `cargo test --lib`; everything UI through browser tests against a scripted backend.
  - Do **not** try to bypass the policy. Run the app on a machine without Application Control to do a real end-to-end pass.
- Every shell call starts fresh: **refresh PATH first** or `cargo` is not found:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- Git identity is `mirimomekiku <lollingworld41@gmail.com>`. **Commit as that user only: no `Co-Authored-By`, no "generated with" lines.**
  The user pushes straight to `main` (no PRs) when asked.

### Commands
```
cd desktop && npm install
npx tsc --noEmit                    # type check (must print nothing)
npm test                            # vitest unit tests
cd src-tauri && cargo test --lib    # Rust tests (use --lib; the bin test target is the one Application Control blocks)
cargo clippy --all-targets          # 5 old warnings are expected (engine.rs x2, meta.rs, setup.rs, lib.rs closure)
cd .. && npm run test:ui            # all browser suites (about 15 minutes)
npm run test:ui -- round8           # one or more suites by file name (without .mjs)
```
- **Chrome is not installed here; Edge is used:** `$env:KAISU_E2E_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'`.
  The harness starts it with `--autoplay-policy=no-user-gesture-required` so audio tests can play.
- **Known, accepted red:** in `chrome.mjs` the 4 "keyboard: ..." menu checks fail in Edge. They fail identically on the
  original code (the Menu key dispatches `contextmenu` differently). Everything else should be green.
- **Run UI suites one at a time on an idle machine.** Overlapping runs (or running other heavy jobs at the same time) cause
  timeouts: `features` and `queue` have each failed once only for that reason and pass alone.
- The runner hides output of passing suites. To debug, add a temporary suite that ends with `check("print", false)` so it prints.

### Tooling gotchas that cost time
- **Bash heredocs mangle backslashes and some quotes.** A regex `[\\/]` became `[\/]` and silently broke code. For any file with
  backslashes, regexes or many quotes use the Write/Edit tools, or write a Python script to a file and run it.
- Large edits were done as small Python scripts that assert each `old` string exists before replacing (`assert old in s`). Keep doing that.
- Files are LF in the working tree; git prints harmless "LF will be replaced by CRLF" warnings (autocrlf).
- In Playwright, `getByRole("button", { name: "Play" })` also matches "Close the **play**er": use `exact: true`.

---

## 3. Architecture map

### Backend, `desktop/src-tauri/src/`
| File | Job |
|---|---|
| `download.rs` | Builds yt-dlp args from a typed request (never from free text), runs it, parses progress. `ActiveGuard` always removes a finished download from the running list. |
| `custom_args.rs` | The Advanced "custom arguments" box: **allowlist** of 127 yt-dlp options (arity generated from yt-dlp's own parser). Never add options that run programs, take a path, or move tools. |
| `scope.rs` | The folders Kaisu may move/delete in are **held by the backend** (`set_managed_folders`); too-broad folders (drive root, user folder, system dirs) are refused. `Scope::media_file(path)` is the one way to turn a page-supplied path into a safe real path. |
| `transfer.rs` | Move/copy/delete inside those folders; companion-file failures are reported (`warning`). |
| `power.rs` | Sleep/shutdown countdown owned by the backend (min 10 s, cancellable, does nothing while a download runs). |
| `secrets.rs` | Proxy password in the OS credential store (`keyring` 4). Allowlisted names only. |
| `net.rs`, `proc.rs` | Proxy validation, `redact_urls` (hides `user:pass@`), proxy passed to yt-dlp **through environment variables**, not argv. |
| `thumbs.rs` | Thumbnails fetched by Rust (proxy, public hosts only, size cap, magic-byte check). The page's CSP no longer allows loading images from the web. |
| `search.rs`, `links.rs` | Search sources (YouTube, SoundCloud, YouTube Music "Songs") and playlist listing. Only sources verified live are offered. |
| `leftovers.rs` | Finds/removes leftover `.part` files in the download folder. |
| `media.rs` | `play_in_app` (asset-protocol access for one file), 20-second `preview_clip`, `convert_audio` (ffmpeg, never overwrites). |
| `library.rs` | **New, half wired.** Scans sound files with `lofty` 0.25, reads tags/properties, caches to `app_data/library.json`, serves covers. |
| `tray.rs` | Tray icon/menu. Music playing counts as "busy" (closing the window keeps Kaisu alive); tray has play/pause/next/previous items. |

### Frontend, `desktop/src/`
- `App.tsx` (about 600 lines) only composes hooks and pages. Logic lives in `hooks/` (`useAppSettings`, `useEngine`, `useSearchFlow`,
  `useDownloadActions`, `useFinishedFiles`, `useLeftovers`, `useMediaDialogs`, `usePlayer`, `useDownloads`, ...) and pure code in `lib/`
  (`extra.ts` builds request options, `siteRules.ts`, `queueOrder.ts`, `library.ts`, `audioEngine.ts`, ...).
- `lib/api.ts` is the **only** place that calls `invoke(...)`; keep all command wrappers there.
- **Pages:** Search, Downloads, History, Settings. The planned **Library** page is not built yet.
- **Test mock of the backend:** `e2e/mock/core.ts` (commands, `convertFileSrc` returning a real silent WAV, `__mock` switches).
  Every new Rust command needs a case there or UI tests throw `unmocked command`.
- Persistent data goes through `lib/storage.ts` (plugin-store file `kaisu.json`): settings, history, queue, `player`, `positions`.

---

## 4. What was done (all committed and pushed unless marked)

1. **Audit** of the whole app; findings fixed: backend-held folders, proxy password (credential store, masked, off argv),
   lyrics consent (opt-in, LRCLIB), thumbnails via backend + CSP, backend power countdown, companion-file warnings, active-list leak,
   failing Windows-path test.
2. **Second round:** `App.tsx` split; queue order (drag, position `#n`) and per-download speed limit; leftover `.part` finder;
   in-app player/preview/convert-to-audio; site rules; custom-args allowlist; YouTube Music search; docs.
3. **Music player (this session's end), committed with this document:**
   - **Step 1, done:** `lib/audioEngine.ts` (queue, resume of long files, speed, sleep timer, repeat/shuffle, error mapping),
     `lib/positions.ts` (remember position only for files over 10 minutes), `lib/mediaSession.ts` (OS media keys/overlay),
     `hooks/usePlayer.ts` (creates the engine, saves/restores queue + positions), `components/PlayerBar.tsx`, tray controls,
     shortcuts Ctrl+Shift+Space / Ctrl+Shift+Left/Right.
   - **Step 2, done:** `components/QueuePanel.tsx` (drag-reorder, jump, remove, clear), "Play next"/"Add to queue" on audio files,
     History multi-select "Play N songs", shuffle/repeat, queue persisted across restarts.
   - **Step 3, half done:** `library.rs` (+ 8 tests), `lib/library.ts` (+ tests: group albums/artists, search, sort, quality label),
     `lib/imageLoader.ts` (shared picture cache; thumbnails and covers both use it), `lib/covers.ts`, `CoverArt` in `Picture.tsx`,
     the bar shows a cover for any track and gives the engine its URL (`engine.setCover`) for the OS overlay.

Tests at the time of writing: about 203 vitest tests, about 140 Rust tests, UI suites `round3`..`round8` (round8 = player + queue, 56 checks).

---

## 5. What to do next (in this order)

### Finish step 3: the Library page (UI only; backend and logic exist)
1. `hooks/useLibrary.ts`: on `files.ready` call `libraryLoad()` (instant, cached) then `libraryScan(progress)` once; expose
   `{ tracks, scanning: {done,total}|null, scan() }`. Rescan (debounced ~2 s) when `history.length` grows after the first scan.
2. `hooks/useVirtualRows.ts`: fixed-row-height windowing for the Songs list (a library can be thousands of rows).
3. `components/LibraryPage.tsx`: search box (`filterTracks`), view switch **Songs / Albums / Artists**, format filter, sort, "Rescan"
   with progress, counts. Songs: virtualized rows, double-click plays from there (queue the next ~500 filtered tracks), row buttons
   Play next / Add to queue / Show in folder. Albums: cover grid, then an album detail view with Play album / Play next / Add to queue.
   Artists: list; click filters Albums by that artist. Use `CoverArt` for covers, `toPlayerTrack` for the player.
4. **Wire it:** `Page` type in `components/Sidebar.tsx` gets `"library"` plus a `songCount` prop and a "Music > Library" item
   (the Sidebar edit was deliberately reverted so no dead link shipped; the first sidebar header "Library" should be renamed to
   "Download" to avoid two things called Library); `App.tsx` renders the page; `Toolbar` `title` should be `"Library"` on that page
   (hides the layout switcher); `useShortcuts` `PAGES` gets a fifth page for Ctrl+5; add it to `lib/shortcuts.ts`.
5. **Mocks + tests:** add `library_load`, `library_scan` (use a `Channel` and send progress), `library_cover` to `e2e/mock/core.ts`
   (cover: reject for some paths to test the placeholder); write `e2e/suites/round9.mjs` (search, views, play from list, album detail,
   rescan, empty state). Update any test that looks for the sidebar header text.

### Step 4: lyrics, tag editor, playlists
- **Synced lyrics:** Rust `read_lyrics(path)` (inside `Scope`, sibling `.lrc` first, then embedded plain lyrics via lofty
  `ItemKey::Lyrics`); `lib/lrc.ts` parser (timestamps `[mm:ss.xx]`, offsets) with tests; a lyrics panel that highlights the current
  line from `usePlayerTime`. LRCLIB lookups already exist for downloads and need consent (`lyricsConsent`).
- **Tag editor:** Rust `write_tags(path, edit)` with lofty (`Option<String>` per field, `Some("")` removes). **Write a temp copy, re-read
  to verify, then rename over the original** (the file may be open in the player on Windows: report a clear error). Dialog for one
  track and bulk-edit for an album; rescan the changed files afterwards. `library.rs` tests already show how to build tagged WAV files.
- **Playlists:** stored in plugin-store (`playlists`), "Add to playlist" menu, play playlist, export `.m3u` (extend `export_text`'s allowed
  extensions in `files.rs`; keep its path checks).

### Step 5: loudness and podcasts
- **Loudness:** Rust `analyze_loudness(path)` runs `ffmpeg -i f -af loudnorm=print_format=json -f null -` and parses `input_i` from
  **stderr** (`proc::run_capture` returns only stdout on success: add a variant that returns stderr). Store LUFS in the library cache
  (`LibTrack.loudness` already exists). Apply with `engine.setLevelGain(db)` = `min(0, -16 - lufs)`: this is **volume-only (never boosts)**
  on purpose, because Web Audio `createMediaElementSource` can output silence for cross-origin asset URLs and could not be tested here.
  Analyse lazily when a track starts, plus an "Analyse library" button with progress; a Settings toggle.
- **Podcasts:** Rust `podcast.rs` (fetch RSS through the proxy with a size cap and the same public-host rules as `thumbs.rs`, parse with
  `quick-xml` or `roxmltree`), subscriptions in the store, check on start and every ~6 hours, auto-download new episodes by queueing the
  enclosure URL with preset `"best"` (not `"audio"`: that would re-encode) into `<download>/Podcasts/<show>/` (inside the registered
  folder so move/delete still work). Resume positions already work for long files.

### Other open items from earlier suggestions
Pin tool hashes for yt-dlp/ffmpeg/Deno instead of trusting the same-release checksum file; sign the Windows exe; CI for Windows + Linux
(none exists); split `SettingsPage.tsx` and `MediaCard.tsx`; an accessibility pass (the password cover hides text visually, not from
screen readers); subscriptions for channels; auto-update of Kaisu itself.

---

## 6. Honest status and risks

- **Not re-verified at the end:** the last full UI run (all suites) was green apart from the Edge-only `chrome` checks **before** the
  final library/cover changes. After them only `tsc` (clean) and `vitest` (203 pass) were run. `Picture.tsx`/`thumbs.ts` were refactored onto
  `imageLoader.ts` and the player bar gained cover loading, so **run `round6`, `round7`, `round8` first** (thumbnails, history, player).
  Rust: `library.rs` tests passed (8); run the full `cargo test --lib` too.
- **Never run for real:** the actual window, ffmpeg conversion, the preview download, `.part` resume, the credential store off Windows,
  Media Session with real hardware keys, tray music items, `lofty` on real MP3/M4A/FLAC (tests use generated WAV files only).
- **Format support:** the Windows web view plays MP3, M4A/AAC, Opus, OGG, FLAC, WAV, not every container (MKV is unreliable); the player shows an
  error and offers "Open in your player" for video files only. A library should eventually badge files the player can't decode.
- **Design decisions worth keeping:** queue resume threshold is 10 minutes (`REMEMBER_FROM_SECONDS`); the saved queue strips temporary
  cover URLs; `engine.position` has its own subscription (it changes 4x a second) so only the bar re-renders; lyrics, tags and any other
  third-party lookup must stay opt-in with a consent dialog (as lyrics did).
