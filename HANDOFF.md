# Handoff: where Kaisu stands and what to do next

Written at the end of a long working session so a new session (human or AI) can pick up without the conversation. Read this first,
then `README.md` (what the app does) and `CONTRIBUTING.md` (how to build and test).

Kaisu is a desktop downloader for videos and music (Tauri v2: Rust backend in `desktop/src-tauri`, React 19 + TypeScript frontend in
`desktop/src`), wrapping yt-dlp and ffmpeg. A separate Python terminal app lives in `tui/` and was not touched.

---

## 1. Current state in one paragraph

Everything from the audit and the two improvement rounds is done, tested and pushed, and so is the audio roadmap except the last
item: the **music player** (steps 1-2), the **library page** (3), **lyrics, tag editor and playlists** (4) and **volume leveling** (first
half of 5) are on `main`. **Podcast subscriptions (second half of step 5) are started but uncommitted and do not compile yet**: see
section 5. Nothing has been run in the real app (see section 6).

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
| `lyrics.rs`, `tags.rs`, `loudness.rs` | Lyrics lookup/reading, safe tag writing, loudness measuring (all path-checked with `Scope::media_file`). |
| `tray.rs` | Tray icon/menu. Music playing counts as "busy" (closing the window keeps Kaisu alive); tray has play/pause/next/previous items. |

### Frontend, `desktop/src/`
- `App.tsx` (about 600 lines) only composes hooks and pages. Logic lives in `hooks/` (`useAppSettings`, `useEngine`, `useSearchFlow`,
  `useDownloadActions`, `useFinishedFiles`, `useLeftovers`, `useMediaDialogs`, `usePlayer`, `useDownloads`, ...) and pure code in `lib/`
  (`extra.ts` builds request options, `siteRules.ts`, `queueOrder.ts`, `library.ts`, `audioEngine.ts`, ...).
- `lib/api.ts` is the **only** place that calls `invoke(...)`; keep all command wrappers there.
- **Pages:** Search, Downloads, History, Library (Songs/Albums/Artists/Playlists), Settings. Podcasts is next.
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

### Finish step 5: podcasts (started, UNCOMMITTED, does not compile yet)
Uncommitted working-tree changes: `Cargo.toml`/`Cargo.lock` (adds `quick-xml = "0.42"`), `src/lib.rs` (registers `mod podcast;` and
`podcast::podcast_fetch`), `src/thumbs.rs` (`check_url` and `build_client` made `pub(crate)`: reused for the public-hosts-only HTTP
rules), and the new `src/podcast.rs`.

**`podcast.rs` state:** has `Feed`/`Episode` types, `parse_duration`, `parse_feed(xml)` (a quick-xml event loop with an element stack),
the `podcast_fetch(url, proxy)` command (5 MB cap, 25 s timeout, public hosts only, enclosure and image URLs filtered with `check_url`,
max 500 episodes) and 5 tests. It was last compiled against **quick-xml 0.42, whose API differs from older docs**, and the last
`cargo test --lib podcast` still had compile errors:
- `Attribute::normalized_value()` takes an `XmlVersion` argument (the old `unescape_value()` is deprecated); find the right way to get
  the attribute text (look at `~/.cargo/registry/src/*/quick-xml-0.42.0/src/events/attributes.rs`).
- `BytesText` has no `.decode()`: text must be unescaped another way (check `events/mod.rs`; entity references arrive as separate
  `Event::GeneralRef` events, which the code already handles for `&amp;`, `&#169;` etc.). Check `BytesCData` the same way.
- Element and attribute names are `&str` in 0.42 (already adapted with sed). If the API is too awkward, `roxmltree` is a fine
  alternative (read-only DOM, no entity expansion problems): swap it in and keep the tests.
The tests in the file define the expected behaviour (entities, CDATA, iTunes image preferred over `<image><url>`, items without audio or
with private addresses skipped, guid fallback to the file URL, 500 cap, duration formats). Make them pass, then `cargo clippy`.

**Still to build:**
1. `lib/api.ts`: `podcastFetch(url)` wrapper (`invoke("podcast_fetch", { url, proxy: currentProxy })`, like `lyricsFind`) and types.
2. `lib/podcasts.ts` (+ vitest): subscription type `{ id, url, title, image?, auto: boolean, seen: string[] (episode ids, cap ~500), checked: number }`,
   `sanitize`, `newEpisodes(feed, seen)`, folder name for a show (safe file name, reuse the idea of `m3uFileName` in `lib/playlists.ts`),
   parse the feed's `published` text with `Date.parse`.
3. Persistence in `lib/storage.ts` (`loadPodcasts` / `savePodcasts`, store key `podcasts`; copy the playlists pattern) and a
   `hooks/usePodcasts.ts` (copy `usePlaylists.ts`): subscribe (fetch, then mark all current episodes as seen so nothing floods the
   queue), unsubscribe, toggle auto-download, check all on start and every ~6 hours, never overlapping.
4. Downloading episodes: use `submitDownloads` from `useDownloadActions` (see `DownloadReq`): `preset: "best"` (**not** `"audio"`: that
   re-encodes), `outDir = <download folder>/Podcasts/<show>` (inside the registered folder so move/delete/library scan still work),
   `title` = episode title, `thumbnail` = feed image. The library then picks the files up on its normal rescan after a download.
5. `components/PodcastsPage.tsx` + Sidebar item "Podcasts" under the "Music" header (`Page` type in `Sidebar.tsx`, `App.tsx`, toolbar
   title, `lib/shortcuts.ts` / `useShortcuts` if you want Ctrl+6): add-feed box with Subscribe, list of shows, a show view listing
   episodes (title, date, length, Download button, "new" badge), Unsubscribe, "Download new episodes automatically" checkbox.
   Say plainly in the UI that adding a feed contacts that website (and that auto-download checks it every few hours).
6. Tests: a `podcast_fetch` case in `e2e/mock/core.ts` (e.g. `__mock.feeds[url]`, `feedFail`), suite `e2e/suites/round12.mjs`
   (subscribe, episodes listed, download queues with the right folder/preset, seen episodes not repeated, auto-download of a new
   episode, unsubscribe, bad feed message). Follow `round10.mjs` for helpers (`open`, `nav`, `check`, `calls`, `waitCalls`).

### Then
- Update this file, run the full verification (section 2 commands; run UI suites one at a time), commit by feature (author only the
  user, no co-author lines) and push to `main` when asked.
- Small polish noted on the way: the Library bar's search/format/sort controls still show on the Playlists view (they do nothing there);
  a song that can't be measured stays "unmeasured" and the "Measure loudness (N)" button keeps counting it (it is not retried this session).

### Other open items from earlier suggestions
Pin tool hashes for yt-dlp/ffmpeg/Deno instead of trusting the same-release checksum file; sign the Windows exe; CI for Windows + Linux
(none exists); split `SettingsPage.tsx` and `MediaCard.tsx`; an accessibility pass (the password cover hides text visually, not from
screen readers); subscriptions for channels; auto-update of Kaisu itself.

---

## 6. Honest status and risks

- **Last verified:** `tsc` clean, vitest 244 tests pass, `cargo test --lib` 156 pass (before `podcast.rs`), UI suites `round9` (45),
  `round10` (49), `round11` (10) pass. The older suites (`round3`..`round8`, `flow`, `features`, `queue`, ...) passed at earlier points
  but were **not all re-run after the library/lyrics/tags/playlists/loudness work**, and `cargo clippy` was not re-run. Do a full pass.
- **Never run for real:** the actual window, ffmpeg conversion and loudness measuring, the preview download, `.part` resume, the credential
  store off Windows, Media Session with real hardware keys, tray music items, `lofty` on real MP3/M4A/FLAC (tests use generated WAV files),
  LRCLIB lookups, tag writing on real files (the temp-copy + verify + rename path is unit-tested only), `loudnorm` output parsing on real ffmpeg.
- **Format support:** the Windows web view plays MP3, M4A/AAC, Opus, OGG, FLAC, WAV, not every container (MKV is unreliable); the player shows an
  error and offers "Open in your player" for video files only.
- **Design decisions worth keeping:** queue resume threshold is 10 minutes (`REMEMBER_FROM_SECONDS`); the saved queue strips temporary
  cover URLs; `engine.position` has its own subscription (it changes 4x a second) so only the bar re-renders; leveling is volume-only
  (Web Audio `createMediaElementSource` can output silence for cross-origin asset URLs); lyrics, tags and any other third-party lookup
  must stay opt-in; the page never gets to pick arbitrary paths (always `Scope::media_file`).
