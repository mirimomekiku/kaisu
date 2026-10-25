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
- `round21` covers playlist folders, custom covers and drag order, waiting-download search/bulk edits, persistence,
  sleep controls and minimum-window layouts. Engine tests cover timed fade-out and finish-current-song behavior.
- `round22` covers delayed-source cancellation, retry/locate/skip, playback quality details, output-device persistence,
  disconnect/reconnect fallback and switching errors. Engine tests additionally cover bounded automatic skipping,
  stale decoder events, loading timeouts, equal-power/album transitions and crossfade rollback.
- `round23` covers the ten-band equalizer, presets, custom gains, reset/bypass, saved settings, fullscreen and minimum-size
  layouts. OfflineAudioContext tests render the production EqualizerGraph to verify boost, attenuation and headroom;
  a context without `setSinkId` exercises the media-stream bridge used when only media-element routing is available.
- `npm run test:real:eq:windows` runs the production DSP graph in the real Windows WebView2, against temporary PCM audio
  served by the Rust capability stream. It measures non-silent output, 6 dB boost, headroom, bypass, volume, mute and both decks.
  It uses a temporary local CDP test session and needs a current debug executable, without ffmpeg or WebDriver.
  Linux uses the shared Web Audio graph and `test:real:playback` with WebKitGTK/tauri-driver; its EQ check measures non-silent
  processed audio. A Linux native run is still needed to validate the installed system's WebKitGTK/GStreamer stack.
- The native media stream echoes CORS access only to the app's own origins (`tauri://localhost`, `http(s)://tauri.localhost`,
  and the Vite dev server in debug builds) and answers any other `Origin` with 403, including Range preflights. Host validation
  and per-request folder authorization still apply, and a URL expires after six hours without a request (each request renews
  it). This avoids the silent cross-origin output required by the [Web Audio specification](https://www.w3.org/TR/webaudio-1.1/).
- Native playback validation requires a newly built app, `tauri-driver`, ffmpeg (`KAISU_FFMPEG` can override its path),
  and on Windows a matching Edge WebDriver (`KAISU_NATIVE_DRIVER`). Close any existing Kaisu instance first.
  `npm run test:real:playback` reports missing prerequisites and writes `src-tauri/target/playback-report.json` with
  passed, failed or blocked status. The runner checks real decoding, long seeks, queue/crossfade controls, corrupt media
  and simulated unavailable paths using temporary files; it does not physically disconnect a drive or verify perceived sound quality.
  See [Tauri WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/).
- Output routing uses the [Audio Output Devices API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId),
  applying the sink to both active and preloaded decks. Device permission prompts are only opened by a user action;
  the app never requests microphone access to enumerate speakers.
- The proxy is passed explicitly to every yt-dlp call and to the setup downloads.
- Search sources are a short list in `search.rs` and `lib/sources.ts`; add one only after checking it returns results.

- Download attempts have distinct native IDs; the persisted recovery ID remains stable. A terminal event is accepted once
  per attempt. `proc::DOWNLOAD_JOB` tracks yt-dlp and final helper processes through verification, including cancellation
  before process startup. Keep process leases alive until the child is reaped.
- `download_manifest.rs` writes recovery records in app data before starting a download and updates the planned path and
  resolved format before media transfer. Proxy credentials are excluded. Successful verification removes the record;
  failure or cancellation keeps it. Recovery is offered only after folder registration and keeps original output choices.
- Preflight groups destinations by filesystem volume and reserves three times known input estimates plus active-job
  reservations and a 200 MiB floor. Unknown sizes remain estimates; free space is checked again at launch. Planned output
  paths are checked before transfer, and final files must exist, be nonempty, remain inside the destination and pass ffprobe.
- `testdata/download-validation.json` supplies the same URL and speed-limit cases, the stall/timeout and retry timings, and the
  secret query-name lists (with names that must and must not be redacted) to TypeScript and Rust tests.
  Change a shared value there and in both `download.rs`/`net.rs` and `errors.ts`/`redact.ts`, or a test fails.
  Scheduling decisions are pure functions in `lib/queueStart.ts` (`pickStartable`, `resourceGate`) with unit tests.
  `npm run test:ui -- round25 queue safety round4 round21` covers lifecycle, late events, stages, recovery, destination
  preflight, retries and existing queue controls. Native process cancellation tests exercise a real helper process.
  Native Linux testing is still required for mount identity and process-group behavior on the target system.

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
3. Tag and publish: `git tag v0.0.4 && git push origin v0.0.4`, then
   `gh release create v0.0.4 desktop/src-tauri/target/x86_64-pc-windows-msvc/release/desktop.exe#kaisu-windows-x64.exe --prerelease --generate-notes`.


## Saved sources and download playlists

`Saved sources` is a manual review workflow, independent of the disabled podcast feature. It keeps a source's public URL,
seen item URLs, pending review items and video/audio/playlist choices in `savedSources`. Checks use the existing bounded
playlist command (500 items). A failed check keeps the review list; accepted items leave it only after the queue snapshot
has been saved. No scheduler or automatic background downloading is enabled.

`extra.library_playlist_ids` holds local destinations for audio downloads. It is excluded from artifact/partial-file identity
and native command arguments, but retained in queue snapshots and native recovery records. Verified completion records
retain pending playlist intents until playlist persistence succeeds. Missing/deleted playlists do not fail a completed download.

`storage.ts` serializes explicit disk saves, exposes failures to StorageNotice and blocks writes after a failed read.
Previous values for playlists, playlist folders, preferences, listening and positions are retained under `backup:*` keys.
These are previous-value copies in the same store, not a separate backup against whole-file corruption.
The native tray/close path requests a frontend flush before exit; a rejected flush cancels exit, with an eight-second
native fallback if the frontend cannot respond. Started jobs still have their independent recovery manifests.

Library polling reconciles every five minutes while visible, and on focus after at least a minute; explicit scans and
post-download scans remain available. View filters and library scroll positions stay in memory across navigation.
`round27` covers settings repair, lookup invalidation, save retries, file-opening errors, download playlists and saved sources.
Terminal jobs now run in isolated process groups, allowing Escape or quit to stop search/inspection and ffmpeg children.
`test_jobs.py` exercises deadlines, stalled cancellation and helper termination without network requests.


## Player practice, profiles, waveforms and session history

A–B boundaries live in PlayerEngine and are not persisted or counted as completed plays. Active loops suppress preloading/
crossfade, clear on queue-entry changes and yield to finish-track sleep. The normal deadline timer can pause a loop.
Engine tests cover boundaries, pause/seek/navigation, sleep priority, completion counts and crossfade suppression.

Playback profiles are validated local settings. Built-ins are Music, Spoken audio and Practice; users can create/update/delete
profiles. Profile application keeps the queue and current position, and applies rate, equalizer, transitions, volume leveling
and long-track position policy. Explicit listening-session restores retain their position even if automatic long-track resume
is disabled. Manual edits mark the active profile Custom.

`media_waveform` is only invoked by the opt-in seek display (`waveformSeek`, false by default). It authorizes the path through
Scope, rectifies each audio channel before mixing/downsampling in ffmpeg, and aggregates streamed float samples into at most
768 bins. Rectification prevents opposite-phase stereo from cancelling out and retains the amplitude of high-frequency sound.
Analysis is serialized, cancellable and limited to two minutes and less than 24 hours of audio. Cache keys include canonical path,
file size and nanosecond modification time; a changed file is refused at completion. Disk cache retains 128 tiny envelopes and
frontend memory retains 32. Failed/cancelled analysis never interrupts playback. The shared native process lease handles cancellation.

Listening sessions use the existing measured listening callback, retain at most 30 snapshots with 500 tracks each, exclude temporary
artwork, preserve duplicate queue occurrences, and save through the normal storage failure/retry and exit-flush paths. New queues
and 30-minute breaks begin sessions; explicit restore pauses and replaces the current queue. App-level relocation updates historical
session paths. The listening dashboard and a player dialog share one store.

`round28` exercises player tools, profile creation/update/persistence, waveform default-off/enabling/cancellation/fallback/fullscreen,
session queue boundaries, persistence, rename/restore/playlist conversion/clear, and minimum-window themes. Run the real waveform
reader against generated, opposite-phase stereo PCM using:

```
cd desktop/src-tauri
cargo test --locked waveform::tests -- --include-ignored
```

The real test uses `../../bin/ffmpeg` by default (`KAISU_FFMPEG` can override it). It requires no network or native window.


Smart playlist rules remain backward-compatible with older saved playlists. Optional `sort`, `descending` and `limit` settings
are sanitized along with rules; ordering is applied before the result cap. Folder equality includes descendant directories but
respects path boundaries, and accepts Windows separators. Presets use the same rule evaluator as live previews and resolved
playlists; persisted smart playlists continue to store rules rather than member paths.

`library_forget_missing` updates only the library cache under `CACHE_EDIT`. Each selected entry must still be marked missing,
fall within an available registered root, and return `NotFound` from `symlink_metadata`. Existing files, symlinks, unavailable roots
and permission errors are retained with per-entry reasons. It never deletes media or edits playlists/history. Cleanup reuses the
existing tag editor, relocation coordination and exact duplicate review; reports are derived locally from cached library metadata.
The report renders 100 rows at once and bounds selections to 500, including selections across pages.

`round29` covers smart presets, live previews, limits, ordering, persistence and folder membership, plus cleanup review/cancel,
partial failures, preserved references, relocation, tag fixes, duplicate access, pagination and minimum-window themes. Run it with
`npm run test:ui -- round13 round14 round29` from `desktop`; pure rule/report tests run with `npm test`, and the native missing-entry
recheck test runs with `cargo test --locked missing_cleanup` from `desktop/src-tauri`.


Customization settings live in `lib/customization.ts`: `appearance`, `sidebar`, `seekPreferences`, `customTheme`, and up to 20
`customizationPresets`. Legacy settings get defaults; every nested setting and snapshot is sanitized on load. Sidebar sanitization
restores missing section IDs, prevents hiding Settings, caps pins, and ignores unknown IDs. Pins resolve against live playlists and
sources, so deleted targets disappear without mutating preset snapshots. Playlist navigation uses a consumed request so revisiting
Library does not reopen an old pin. Source pins use the normal Search lookup.

`customizationDom.ts` applies bounded interface properties and validated custom-color CSS variables. Custom palettes disable the
legacy full-page dark/graphite and accent filters; turning them off removes only their variables. Theme JSON imports are bounded to
32 KB, versioned, hex-only, and checked for text contrast. Editors preview drafts separately from active settings. Presets capture
only customization fields, excluding download paths, proxy secrets, playback profiles and queues. Reset controls are scoped by area.

`useSeekControls` supplies shared range-key and optional non-passive wheel handlers for the bar, full-screen and mini-player. J/L
shortcuts ignore text fields, composition, modifiers and unrelated modals. Shift uses the fine interval; seeking clamps to duration,
unknown duration is ignored, and wheel handling is throttled for trackpads. Default wheel behavior leaves page scrolling intact.

`round30` covers settings visibility, live appearance, sidebar reorder/hide/pins/routing/persistence, theme contrast/import/export,
shared keyboard/wheel seeking, presets and resets, and the largest text size at minimum window dimensions. Existing `round18`,
`round20`, `round27`–`round29` cover adjacent settings, player, persistence and library behavior.
