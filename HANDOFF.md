# Handoff: where Kaisu stands and what to do next

Written at the end of a long working session so a new session (human or AI) can pick up without the conversation. Read this first,
then `README.md` (what the app does) and `CONTRIBUTING.md` (how to build and test).

Kaisu is a desktop downloader for videos and music (Tauri v2: Rust backend in `desktop/src-tauri`, React 19 + TypeScript frontend in
`desktop/src`), wrapping yt-dlp and ffmpeg. A separate Python terminal app lives in `tui/` and was not touched.

---

## 1. Current state in one paragraph

The music player, library, lyrics, tag editor, playlists and volume leveling are committed on `main`. The podcast work started by
CLAUDE has now been completed in the working tree: RSS parsing, subscriptions, manual/automatic downloads, persistence, a Podcasts
page and Ctrl+6 navigation. The two small library polish items are also fixed. These changes are committed on `main` in separate feature commits (section 5).
Native-app behavior has still not been verified in this environment; see section 6.

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
| `library.rs` | Scans sound files with `lofty` 0.25, reads tags/properties, caches to `app_data/library.json`, serves covers. |
| `podcast.rs` | RSS 2.0/iTunes feed parsing and fetching through the thumbnail public-host/proxy rules; 5 MB and 500 episode caps. |
| `lyrics.rs`, `tags.rs`, `loudness.rs` | Lyrics lookup/reading, safe tag writing, loudness measuring (all path-checked with `Scope::media_file`). |
| `tray.rs` | Tray icon/menu. Music playing counts as "busy" (closing the window keeps Kaisu alive); tray has play/pause/next/previous items. |

### Frontend, `desktop/src/`
- `App.tsx` (about 600 lines) only composes hooks and pages. Logic lives in `hooks/` (`useAppSettings`, `useEngine`, `useSearchFlow`,
  `useDownloadActions`, `useFinishedFiles`, `useLeftovers`, `useMediaDialogs`, `usePlayer`, `useDownloads`, ...) and pure code in `lib/`
  (`extra.ts` builds request options, `siteRules.ts`, `queueOrder.ts`, `library.ts`, `audioEngine.ts`, ...).
- `lib/api.ts` is the **only** place that calls `invoke(...)`; keep all command wrappers there.
- **Pages:** Search, Downloads, History, Library (Songs/Albums/Artists/Playlists), Settings and Podcasts.
- **Test mock of the backend:** `e2e/mock/core.ts` (commands, `convertFileSrc` returning a real silent WAV, `__mock` switches).
  Every new Rust command needs a case there or UI tests throw `unmocked command`.
- Persistent data goes through `lib/storage.ts` (plugin-store file `kaisu.json`): settings, history, queue, `player`, `positions`, `playlists` and `podcasts`.

---

## 4. What was done (all committed and pushed unless marked)

1. **Audit** of the whole app; findings fixed: backend-held folders, proxy password (credential store, masked, off argv),
   lyrics consent (opt-in, LRCLIB), thumbnails via backend + CSP, backend power countdown, companion-file warnings, active-list leak,
   failing Windows-path test.
2. **Second round:** `App.tsx` split; queue order (drag, position `#n`) and per-download speed limit; leftover `.part` finder;
   in-app player/preview/convert-to-audio; site rules; custom-args allowlist; YouTube Music search; docs.
3. **Music player, steps 1-2:** `lib/audioEngine.ts`, `lib/positions.ts`, `lib/mediaSession.ts`, `hooks/usePlayer.ts`,
   `components/PlayerBar.tsx`, `QueuePanel.tsx`, tray controls, shortcuts, queue persisted across restarts.
4. **Step 3, the library:** `library.rs` scanner/cache, `lib/library.ts`, `hooks/useLibrary.ts`, `hooks/useVirtualRows.ts`,
   `components/LibraryPage.tsx` (Songs virtualized / Albums / Artists / Playlists, search, format filter, sort, rescan), sidebar entry
   "Music > Library", Ctrl+5. Suite `round9` (45 checks).
5. **Step 4:** `lyrics.rs` + `lib/lrc.ts` + `LyricsPanel.tsx` (synced/plain lyrics, click to seek, opt-in LRCLIB lookup);
   `tags.rs` + `lib/tagEdit.ts` + `TagEditor.tsx` (edits a temp copy, verifies, then renames; whole-album edit);
   `lib/playlists.ts` + `hooks/usePlaylists.ts` + `PlaylistPicker.tsx` + `PlaylistsView.tsx` (stored in plugin-store key `playlists`,
   play/queue/rename/reorder/delete, export `.m3u8` via `export_text`, which now allows `.m3u`/`.m3u8`). Suite `round10` (49 checks).
6. **Step 5, loudness (done, pushed as `3f68f03`):** `loudness.rs` (`library_analyze`, parses `loudnorm` JSON from stderr; new
   `proc::run_capture_stderr`), `lib/loudness.ts` (`levelGain`: never boosts, target -16 LUFS), `hooks/useLoudness.ts` (sets
   `engine.setLevelGain` for the playing song, measures an unmeasured one lazily), `useLibrary` gained `measure`/`analyse`/`stopAnalysing`,
   Library page button "Measure loudness (N)", Settings toggle `levelVolume` (default off). Suite `round11` (10 checks).

---

## 5. What to do next (in this order)

### Step 5: podcasts (implemented and committed)
- Kept `quick-xml = "0.42"`; adapted attributes and text/CDATA to its actual API. Parser rejects incomplete/non-RSS documents,
  skips non-audio MIME types and private URLs, unescapes enclosure attributes and deduplicates GUIDs. Seven Rust parser tests.
- `lib/podcasts.ts`: URL normalization, subscription sanitization (max 50), seen IDs (max 500), episode dates and safe show folders.
- `lib/storage.ts`: `podcasts` key. `hooks/usePodcasts.ts` lives in App so checks continue away from the Podcasts page. Subscribe
  records current episodes without downloading them; automation defaults off. Startup and six-hour refreshes never overlap.
  Failed feed requests keep subscriptions; refused queue submissions remain eligible for retry. Unsubscribe during an in-flight
  request cannot recreate the subscription. Unsubscribing does not delete downloaded files.
- `components/PodcastsPage.tsx`, Sidebar entry under Music, toolbar title and Ctrl+6. UI explains website contact and polling.
- Episode downloads use `submitDownloads`, `preset: "best"`, original audio and `<download folder>/Podcasts/<safe show title>`.
  `DownloadReq.applySiteRules = false` prevents site rules from changing the preset or redirecting a podcast outside that folder.
- `api.ts` contains the `podcast_fetch` wrapper and types; `e2e/mock/core.ts` adds feeds/feedFail/feedDelay controls.
- `round12` has 27 browser checks; six new pure frontend tests cover feed URLs, seen IDs, dates, folders and sanitization.
- Library polish: hide search/format controls in Playlists, and exclude failed loudness measurements from the pending button count.
  `round11` now has 12 checks.

### Verification and next action
Verification is complete (2026-10-22): production frontend build and unit checks pass. All browser suites were run sequentially;
only the four previously documented Edge keyboard-menu checks remain red. See section 6 for counts and limitations.
The completed work is split into these commits, authored and committed only by mirimomekiku:
- `3948d17`: podcast subscriptions and episode downloads.
- `2aeb287`: playlist controls and loudness measurement counts.
- `61d7f94`: preserve clip/tag edits after manual lookup, with regression coverage.

The user authorized pulling and pushing these commits directly to `main`. The remaining work is the separate audit findings below.

The full run exposed an older search race: pressing Enter did not cancel the already-scheduled simple-mode automatic lookup.
It could run again after 700 ms, unmounting the media card and discarding clip/tag edits. `useSearchFlow.ts` now rechecks
`lastAutoInspected` when the debounce fires. The features suite explicitly waits past that delay and verifies edits survive.
The features suite's stale three-group shortcut assertion also now includes the existing Music player group.

### Findings from the read-only audit that remain separate work
- Queue persistence stores `extra.proxy` unchanged, so proxy credentials can still land in `kaisu.json` despite settings using
  the credential store. Strip credentials from saved queue entries and restore the current proxy at download time.
- Site-rule folders outside the two registered roots do not participate in library scanning or scoped media actions.
- Library automatic rescans are driven by history count, so repeated downloads or file moves can leave stale entries.
- Keep-both transfer naming chooses media and companion names independently, which can detach subtitles/lyrics from a renamed song.

### Other open items from earlier suggestions
Pin tool hashes for yt-dlp/ffmpeg/Deno instead of trusting the same-release checksum file; sign the Windows exe; CI for Windows + Linux
(none exists); split `SettingsPage.tsx` and `MediaCard.tsx`; an accessibility pass (the password cover hides text visually, not from
screen readers); subscriptions for channels; auto-update of Kaisu itself.

---

## 6. Honest status and risks

- **Last verified (2026-10-22):** `npm run build` (TypeScript + Vite) passes; vitest **250 passed in 29 files**;
  `cargo test --lib --offline`: **163 passed, 1 ignored**; `cargo clippy --all-targets --offline` completes with only the five
  existing warnings listed in section 2. Vite reports a non-failing chunk-size warning (main JS approximately 520 kB).
- **Browser verification:** full sequential run, then affected suites rerun after the lookup fix and podcast edge-case tests.
  Final passing counts by suite: `chrome` 73 (plus the four known Edge failures), `features` 70, `flow` 92, `queue` 43,
  `round3` 92, `round4` 77, `round5` 56, `round6` 39, `round7` 65, `round8` 56, `round9` 45, `round10` 49,
  `round11` 12, `round12` 27, `safety` 56. **852 passing checks across these suites; only the four known Edge menu checks fail.**
  The initial full run's clip/tags failures were fixed, and the stale shortcuts assertion was updated; `features`, `flow`,
  `round4`, `round7` and `round12` were rerun. The earlier audit's round10 initial page-load timeouts did not recur in the full run.
- **Visual check:** inspected a rendered Podcasts page at 1060 x 800 with subscribed-show navigation, episodes, dates, lengths,
  a New badge and download controls. Browser tests use the scripted backend and do not prove native/network integration.
- **Never run for real:** the actual window, ffmpeg conversion and loudness measuring, the preview download, `.part` resume, the credential
  store off Windows, Media Session with real hardware keys, tray music items, `lofty` on real MP3/M4A/FLAC (tests use generated WAV files),
  LRCLIB lookups, real podcast RSS/enclosure downloads, tag writing on real files (the temp-copy + verify + rename path is unit-tested only), `loudnorm` output parsing on real ffmpeg.
- **Format support:** the Windows web view plays MP3, M4A/AAC, Opus, OGG, FLAC, WAV, not every container (MKV is unreliable); the player shows an
  error and offers "Open in your player" for video files only.
- **Design decisions worth keeping:** queue resume threshold is 10 minutes (`REMEMBER_FROM_SECONDS`); the saved queue strips temporary
  cover URLs; `engine.position` has its own subscription (it changes 4x a second) so only the bar re-renders; leveling is volume-only
  (Web Audio `createMediaElementSource` can output silence for cross-origin asset URLs); lyrics, tags and any other third-party lookup
  must stay opt-in; the page never gets to pick arbitrary paths (always `Scope::media_file`).
