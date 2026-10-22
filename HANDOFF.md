# Handoff: where Kaisu stands and what to do next

Written at the end of a long working session so a new session (human or AI) can pick up without the conversation. Read this first,
then `README.md` (what the app does) and `CONTRIBUTING.md` (how to build and test).

Kaisu is a desktop downloader for videos and music (Tauri v2: Rust backend in `desktop/src-tauri`, React 19 + TypeScript frontend in
`desktop/src`), wrapping yt-dlp and ffmpeg. A separate Python terminal app lives in `tui/` and was not touched.

---

## 1. Current state in one paragraph

The published baseline is on `main` through `45179d5`. New work in the working tree implements the user's selected
features: imported music folders with polling and missing-file recovery, smart playlists, exact duplicate review/removal,
and an always-on-top mini-player. Podcasts are temporarily hidden; their implementation and saved subscriptions are retained,
and background feed checks/automatic downloads are disabled by default. See section 7 for the current changes and verification.
The next requests add favorites/ratings, a listening dashboard and recoverable deletion (section 8), then artwork editing and preloaded/crossfade playback (section 9).
Native-app behavior has still not been verified in this environment.

---

## 2. How to work in this repo (read before running anything)

### The machine this was built on
- **Windows 11, standalone PC, Application Control is on** (AppLocker rules + Smart App Control). Consequences:
  - `winget` is blocked. Rust, MSVC Build Tools (Desktop C++ workload) and Node were installed by hand.
  - AppLocker has an allow rule for `D:\laragon\www\kaisu\*`. Freshly built executables are **sometimes** still refused with
    `os error 4551` ("An Application Control policy has blocked this file"), e.g. `target\debug\desktop.exe` and occasionally the
    `main.rs` test binary. **The real app (`desktop.exe`) has never been launched in this environment.** The published baseline used
    `cargo test --lib`; the latest test executable is now also blocked (see section 7). UI verification uses browser tests against a scripted backend.
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
- Rescan finding addressed by section 7: history path/timestamp revisions now trigger scans, plus optional 15-second/focus polling.
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


## 7. Current feature work (2026-10-22, uncommitted)

The user asked to hide Podcasts without deleting it and implement recommendations 1, 4, 7 and 8. No new pull/commit/push
was requested for this work. Do not confuse the historical verification in section 6 with these new changes.

### Behavior and implementation
- **Podcasts paused:** `lib/features.ts` defaults off. Navigation, Ctrl+6 and its shortcut entry are hidden; the existing
  hook receives `ready=false`, so startup checks, six-hour checks and automatic downloads stop. Subscription storage is
  untouched. `VITE_ENABLE_PODCASTS=true` at build/dev time restores the retained feature and runs the full legacy round12 suite.
- **Imported collections:** Library > Music folders uses a native Rust folder chooser; roots persist in backend-owned
  `library-folders.json` and restore at startup. Up to 50 roots; existing scanner caps remain 100,000 tracks and eight levels.
  Files stay in place. Imported roots allow playback, tags, lyrics, loudness and explicit duplicate removal; automatic
  transfer/delete cleanup still uses only download/moved roots. Removing a library root never deletes its files.
- **Watching/missing files:** optional polling every 15 seconds and on window focus, saved under `libraryWatch` (default on).
  Cached missing entries remain under registered roots. Available/Missing/All filters, missing counts and Locate file
  reconnect moved files. Import their containing folder first if outside existing roots. Relocation updates manual playlists,
  listening stats, history, player queue and long-track resume positions. History path/timestamp changes trigger rescans
  even when the history count is unchanged. Scans coalesce overlapping requests.
- **Smart playlists:** New smart playlist in Library > Playlists; all/any rules for title/artist/album/genre/format/year,
  play count, added-within-days and played/unplayed. Stored rules resolve against available music, sorted by title (max 5,000).
  Rules can be edited, renamed, deleted, queued or exported as a snapshot. Existing manual playlists are retained.
  `listening` stores completed play counts/lastPlayed; pauses/skips do not count, completed repeats do. Time rules refresh
  at least every minute while the playlists view is mounted. `added` persists import time, falling back to modified for legacy caches.
- **Duplicates:** explicit SHA-256 byte comparison, size prefilter, streamed reads with change checks. No removals preselected.
  User chooses a keeper, selects other copies and reviews before permanent deletion. Backend revalidates scope and both hashes
  before each removal; the keeper cannot be removed. Companion files stay. Successful removals purge cache entries and refresh UI.
- **Mini-player:** Mini button in the player bar switches the existing main webview to 480x210, minimum 420x180, always on top.
  Same audio engine and queue continue; previous/play/next/seek/volume controls work. Full window restores geometry,
  resizability, topmost and maximized state. Failed window operations surface errors and leave restore available.
- `library::CACHE_EDIT` serializes scan, tag, loudness, relocation and duplicate cache writes.

### Current verification
- Frontend: 260 unit tests in 30 files passed; TypeScript and the production Vite build passed (existing large-chunk warning).
- Browser baseline regressions: features 70, flow 92, round8 56, round9 45, round10 49 and round11 12 passed (324 checks).
- Default hidden-podcast round12: 4 checks passed, including preserved automatic subscriptions and no feed/download requests.
- Retained enabled-podcast round12: 27 checks passed with `VITE_ENABLE_PODCASTS=true`. These changes hide/pause the feature without deleting it.
- Total distinct checks across the selected browser suites/feature-flag variants: 387 passed.
- New round13: 32 checks passed, including relocation across playlists/listening/history, watcher persistence/cancellation,
  smart-playlist snapshot exports and mini-player layout at 480x210 and 420x180. Round9/round10 also passed again after final missing-album safeguards.
- Mini-player screenshot inspected at 480x210: all controls fit; screenshot is under ignored `src-tauri/target/mini-player.png`.
- Rust: a first compilation of the new modules succeeded, but the rebuilt library test executable was blocked before it ran.
  Subsequent `cargo check --all-targets` was blocked at the app build script, and `cargo clippy --all-targets` was blocked at
  cargo-clippy itself (`os error 4551`). Therefore the final Rust edits have not passed native compile/test/lint verification.
  New Rust tests cover exact hashing/removal refusal, missing-file restoration/cache migration/root removal and imported scope isolation.
- Native playback, native choosers and actual always-on-top/window geometry remain unverified. Application Control blocks
  the native app. Do not bypass that policy.


## 8. Favorites, listening dashboard and recoverable removal (2026-10-22, uncommitted)

The next user selected recommendations 1, 7 and 8. These changes build on section 7; nothing was committed or pushed.

- `musicPreferences` in plugin-store holds favorite/rating per file. Values are sanitized (integer 0..5, 0 unrated), empty
  entries removed, and relocation merges favorite flags and keeps the higher rating. An App-level context shares preferences
  across library and player. Song rows show heart/rating controls; the player bar has a heart. Library filters favorites/minimum
  rating. Smart rules add `favorite` (yes/no) and `rating` (is/at least/at most); memberships update immediately.
- Library > Listening is an all-time, local dashboard: total completed plays, measured listening time, distinct tracks,
  recently played, most played songs and top artists. Counts include unavailable tracks, with playback disabled for them.
  Metadata snapshots preserve titles/artists after files leave the library. Legacy counts remain; historical listening time
  is not invented. Unknown per-song/artist time is shown as `--`.
- The player engine samples actual media advance against elapsed wall time, adjusted for playback speed. It batches `onListen`
  callbacks, flushing on pause, seek, track switch, clear and end. Buffering, seeks, paused time and suspended-clock gaps >30s
  are excluded. Partial listening adds seconds without incrementing completed plays. New optional `ListeningEntry` fields:
  `seconds`, `lastListened`, `title`, `artist`. Relocation/load merges counts, seconds and latest timestamps.
- Manual file removal offers Cancel / Move to Recycle Bin / Delete file permanently. Duplicate removal defaults to recycling,
  with an explicit permanent mode; changing mode clears review so a new review is required. Existing hash/scope checks remain.
- Settings > Clean up adds a deletion method (recycle by default). Both automatic and manual age-based cleanup use it.
  Enabling permanent cleanup requires confirmation. Emptying the bin is required to reclaim disk space. Imported roots remain
  outside automatic cleanup. Companion-file removal failures now surface as warnings after the media file succeeds.
- Rust `removal.rs` dispatches permanent unlink vs recycling with no fallback. Windows uses `IFileOperation` on a fresh COM
  apartment, a progress sink that vetoes any PreDeleteItem lacking `TSF_DELETE_RECYCLE_IF_POSSIBLE`, explicit recycle flags,
  and abort/error checks. Non-Windows uses `trash` 5.2.9. Windows `windows`/`windows-core` 0.62.2 are direct target dependencies.
  The Windows guard follows the [PreDeleteItem contract](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-predeleteitem).

Verification completed for the available checks:
- `npm run build`: TypeScript + Vite pass (existing large-chunk warning). `npm test`: 271 passed in 31 files.
- `cargo check --all-targets`: passes, including the Windows COM implementation and native test sources.
- Browser regression suites: round10 49, round11 12, round13 33, round14 26, round5 56, round8 56, round9 45:
  **277 checks passed**, no page errors. Round13 includes favorites/ratings relocation; round14 covers persistence,
  filters, live smart rules, dashboard totals/rankings, partial playback vs completion, pause accounting, deletion mode
  choices, failed recycling and guarded permanent cleanup. Legacy round5 assertions now expect recoverable default copy.
- Screenshots inspected for song preferences/player heart and the dashboard; artifacts are ignored under `src-tauri/target/`.
- The rebuilt Rust test executable and cargo-clippy are blocked by Application Control (4551); no policy bypass attempted.
  Native recycling/restore, playback and window behavior remain unverified in the real Tauri app.
- Removal helpers reject directories and symbolic links; companion failures are reported as warnings. Native unit coverage
  verifies recycling failure keeps the original and never falls back to permanent deletion, and that directories never
  reach the recycling API (compiled, not executed due to policy).


## 9. Artwork editor and playback transitions (2026-10-22, uncommitted)

The latest user chose recommendations 3 and 7. This work builds on sections 7/8; nothing committed or pushed.

### Artwork
- Edit tags now contains a current/selected preview, Choose image, Remove embedded artwork and Keep current artwork.
  The same action applies to all selected album songs; partial failures stay visible and can be retried. Save is blocked
  while choosing/loading a preview. Native image selection does not write any music until Save.
- Rust `artwork.rs`: native JPEG/PNG chooser, bounded 8 MiB read, image 0.25.10 decoding with 4096x4096 dimension and
  64 MiB allocation limits. At most four selected byte buffers are retained behind tokens. Preview returns binary bytes;
  closing/replacing a selection discards its token and browser URL. No arbitrary image path is accepted from the page.
- `TagEdit.artwork` is replace-with-token or remove. Replacing preserves other picture types and replaces the front cover;
  removal clears embedded pictures only. Shared folder covers are retained and can still appear afterward.
- Existing copy/write/read-back/rename safety now verifies embedded image bytes/type as well as tags and duration. Failed
  edits keep the original. Working-copy reservation uses create_new so existing files cannot be overwritten or removed;
  library/duplicate scans exclude reserved `.kaisu-tag-tmp.` names. Up to 500 songs per edit.
- Cover lookup prefers front covers. ImageLoader invalidation notifies rendered covers and rejects old in-flight responses.
  Queue cover revisions refresh player/system artwork. Editing releases active/preloaded file handles and blocks reopening
  those paths until saving completes; playback stays paused and can resume at its previous position.

### Playback transitions
- Settings > Playback transitions: `gaplessPlayback` defaults true, `crossfadeSeconds` defaults 0 (off), range 0..12.
  Disabling preloading also disables active crossfade; the saved duration remains available for re-enabling.
- `PlayerEngine` can create a standby audio element, pre-authorize/preload the actual successor, and promote the prepared
  element after the outgoing track ends without resolving it again. Timing is browser/format-dependent; sample-accurate
  gapless playback is not guaranteed. No Web Audio graph is used (asset-protocol compatibility).
- Crossfade monitors media position every 40 ms, capped at half each song's duration, and uses complementary linear gains.
  Per-track loudness gain and global volume/mute are applied to both decks. A completed outgoing tail is counted once;
  interrupted tails retain resume positions without a completion. Listening seconds are gain-weighted during overlap to
  avoid doubling total listening time. Incoming UI/queue/Media Session represent the incoming song from promotion onward.
- Pause/resume and buffering pause/resume both decks. Seek, manual track changes, queue-order changes, disabling transitions,
  clear and disposal cancel outgoing tails or stale preloads. Next failures leave the current song playing and fall back to
  normal loading at the boundary. Repeat-one and sleep-after-track do not overlap; repeat-all can preload the first track.
- Current cover-only metadata updates do not invalidate a prepared successor. Source-load tokens prevent canceled loads
  and promotions from resurrecting playback or reopening a file during editing.

### Verification
- Frontend unit tests/build in progress; affected browser suites pending final results.
- Rust library tests ran successfully: 170 passed, 1 ignored, including image bounds/decoding, verified artwork add/remove,
  invalid artwork preserving originals, working-copy collision protection, and previous removal/scope tests.
- Clippy remains blocked by Application Control (4551). Native Tauri window/audio/chooser integration remains unverified;
  real browser audio is exercised through the scripted-backend suites. Do not bypass the policy.
