**Kaisu audit and feature roadmap — 2026-10-23**

Reviewed application version 0.0.4 at commit `8f4d354`, including the existing uncommitted UI/configuration changes and `round26` suite. The original audit is recorded below. A subsequent implementation pass addressed the findings and added the two selected features; its status is recorded here.

**Implementation follow-up**

Implemented download-to-playlist and saved channels/playlists with manual checks and review before download. Audio jobs retain local playlist destinations through queue snapshots and native recovery; verified completions keep pending playlist intents until membership is saved. Saved sources retain unseen/review state and format choices, preserve pending items after check/preflight failures, and save accepted queue entries before removing review items. Checks inspect at most 500 entries and do not schedule background downloading.

| Finding | Implementation |
| --- | --- |
| 1 | Type/schema validation of persisted settings and nested schedule rules; render-error recovery with settings reset |
| 2 | Search, inspection, listing and batch transitions invalidate competing requests and busy state |
| 3 | Removed persisted 500-record truncation; History renders 500 matches at a time while filtering/exporting all records; availability checks are batched |
| 4 | Explicit serialized saves, persistent failure/retry notice, write protection after failed reads, previous-value copies for key personal collections, and frontend/native exit flushing |
| 5 | Opening/revealing errors recheck existence instead of marking the file missing unconditionally |
| 6 | Terminal extraction runs in managed subprocess groups; cancellation/deadlines cover search, inspection and ffmpeg descendants |
| 7 | Polling reduced from 15 seconds to five minutes while visible; focus scans throttled to one minute; removed per-track JSON serialization comparisons; limits described in the UI |
| 8 | Major optional pages load separately; Library/History view preferences and Library scroll survive navigation; playback queue limits are surfaced |

Previous-value copies live in the same store and are not a full backup against file corruption. Large-library/physical-drive performance and native Windows shutdown/playback still need target-machine validation. Polling remains reconciliation-based rather than a native filesystem-event watcher. The remaining future features in the roadmap are suggestions, not implemented scope.

Implementation verification: TypeScript and production build pass; 442 frontend tests, 206 Rust tests (one additional ignored test), and 19 terminal tests pass. The expanded `round27` suite passes 37 checks covering both features, settings repair, stale results, storage failures/read protection, recovery/cancellation/retry, concurrent completions, exit flushing and minimum-width themes. The main application chunk is approximately 479 kB (145 kB gzip), down from the original 658 kB (194 kB gzip), with optional pages emitted separately. All 31 UI suites passed across the full run and final targeted reruns. The full development run exposed six failing suites (`flow`, `round14`, `round16`, `round17`, `round18`, `round20`); after correcting async navigation, delayed persistence and scroll behavior, those six passed their final combined reruns (259 checks). `round27` was expanded and rerun separately to its final 37 checks. The verification section at the bottom describes the original audit baseline.

**Assessment**

Kaisu's strongest product direction is a local media workflow: find something, save it reliably, organize it, and listen to it. The app already has substantial download and music-player functionality. The next release would benefit most from stronger persistence/recovery and improvements connecting downloading to the library.

This is a repository and targeted runtime audit. Confirmed reproductions below use the real React UI in Chrome with the repository's mocked Tauri backend. Native Rust unit tests were also run. Native Windows/Linux playback, physical drive removal, desktop accessibility and large-library performance were not validated in this session. Passing browser tests does not establish native webview behavior or absence of security vulnerabilities.

**Application context**

| Area | Current implementation |
| --- | --- |
| Desktop | Tauri 2; React 19, TypeScript, Vite, Tailwind; Windows/Linux focus |
| Discovery | YouTube, YouTube Music and SoundCloud search; arbitrary supported HTTP(S) links; playlists/channels; multi-link paste/drop |
| Downloads | Rust launches yt-dlp/ffmpeg; typed commands and progress events; queue, pause/retry, recovery manifests, output verification, rate/fragment budgets, site rules, proxy/cookies, clips/subtitles, conflict policies |
| Local library | Rust/Lofty scans downloaded, moved and imported roots; tags/artwork, favorites/ratings, playlists and smart rules, duplicate review, missing-file relocation |
| Playback | Shared browser audio engine; two decks, preloading/crossfade, Web Audio EQ, output selection, lyrics, sleep timer, mini/fullscreen player, resume positions and listening statistics |
| Files | Scoped native operations, verified move/copy with companions, Trash/Recycle Bin, opt-in permanent cleanup |
| State | `kaisu.json` holds settings, queue, history, playlists and listening/player preferences; separate native library cache, folder registry and download recovery records; system credential store for secrets where available |
| Terminal app | Separate Python Textual UI using yt-dlp directly; search, inspect, presets and tool setup; much narrower than desktop |
| Hidden functionality | Podcasts remain in code behind `VITE_ENABLE_PODCASTS`; default UI and background work are disabled |
| Distribution | Portable executable builds, helper-tool setup and yt-dlp updates; no configured application updater; manual releases and no CI, per CONTRIBUTING |

Main flows:

1. `App.tsx` composes settings, queue, history, library, playback and file-management hooks.
2. `useSearchFlow` gets metadata/listings through `lib/api.ts`; `useDownloadActions` applies choices, rules, duplicate checks and preflight.
3. `useDownloads` schedules attempts; Rust `download.rs` builds commands, manages outputs/recovery and emits events. Successful completion updates history.
4. History drives finished-file availability, automatic moves/cleanup and library rescanning. Relocation propagates into player, playlists, preferences and listening records.
5. The library supplies local tracks to the player; Rust authorizes files and supplies loopback capability URLs for playback.

Useful starting points: `desktop/src/App.tsx`, `desktop/src/hooks/useDownloads.ts`, `desktop/src/lib/storage.ts`, `desktop/src/lib/audioEngine.ts`, `desktop/src-tauri/src/download.rs`, `desktop/src-tauri/src/scope.rs`, `desktop/src-tauri/src/media_stream.rs`, `desktop/src-tauri/src/library.rs`, and `tui/app.py`.

**Audit findings, in recommended fix order**

1. **High impact, malformed-state trigger: saved settings can produce a blank app. Confirmed.** `loadSettings` merges persisted values with defaults but does not validate every field (`desktop/src/lib/storage.ts:234`). With a valid JSON settings object containing `schedule: null`, `App.tsx:139` throws on `.filter()` after startup; the React root becomes empty. `main.tsx` has no error boundary. Validate persisted fields at the boundary, including nested arrays, and provide a recovery screen that can reset settings while retaining other data. Test malformed fields and migrations. This reproduction deliberately injected malformed state; it does not show that ordinary UI use creates that value.

2. **Medium: old lookup responses can overwrite newer user intent. Confirmed.** `useSearchFlow.ts:97` and `:123` use separate inspection/search tokens; switching operation types does not invalidate both. Start a search and submit a video link before the search resolves: old search results reappear below the new video's details. Start inspecting a private link, then submit several other links: the old inspection error appears on the new batch. `showLinks` invalidates only the search token (`:150`) and does not reset all busy state. Use one intent generation for search, inspection, listing and batch changes, or consistently invalidate both tokens; guard errors and finalizers as well as results. Preserve intentionally displayed search results when selecting one of them.

3. **Medium: a display-history limit also limits long-lived automation records. Code-confirmed.** `MAX_HISTORY = 500` and `saveHistory` truncates persisted history (`storage.ts:229`, `:359`). `useAutoMove` and `useAutoDelete` derive work from that same history. After more than 500 distinct completion records, older entries disappear on restart, weakening duplicate warnings and making older pending transfers/cleanup undiscoverable through those hooks. Media files remain on disk. Keep a durable completion/job ledger separate from the visible recent-history window, with explicit retention. SQLite is a reasonable option once volume justifies it; first remove the coupling and document retention.

4. **Medium: persistence failures are invisible to the user. Code-confirmed.** Settings, playlists, queue and preference save helpers catch errors and log warnings (`storage.ts:325`, `:357`, `:470`, `:523`, `:540`). UI state can change successfully while disk persistence fails. Return save outcomes and show a persistent, actionable save-failure notice with retry. Distinguish read failure from an intentionally empty collection, and retain a known-good backup. Queue snapshots also use a one-second timer (`useQueuePersistence.ts`); add explicit shutdown flushing for frontend-owned state. Native manifests already protect started downloads, so they should remain independent.

5. **Medium: opening/revealing a file can incorrectly mark it missing. Code-confirmed.** `useDownloadedFiles.ts:34` sets `existing[path] = false` on any opener error. A system file-manager/player failure does not establish that the file disappeared; the resulting state can hide available file actions until a later refresh. Recheck existence after an action error, and distinguish missing file from failed launch. Verify using an existing file with a mocked opener failure.

6. **Medium, terminal-specific: cancellation is cooperative and incomplete. Code-confirmed.** Escape sets a threading event (`tui/app.py:290`); checks happen only in download/postprocessor hooks (`:453`, `:473`). Search and inspection do not consume it, and an already running ffmpeg operation cannot observe it until a later hook. A request may remain busy after displaying “Cancelling…”. Use managed subprocess jobs with deadlines and process-tree cancellation, or clearly scope the terminal UI's cancellation behavior. The desktop's process-job implementation provides a useful model. No native hung-process reproduction was attempted.

7. **Performance concern: library watching repeatedly traverses every registered root. Not benchmarked.** `useLibrary.ts:85` scans every 15 seconds and on focus. Rust reuses unchanged tags, but still recursively enumerates and stats files; the whole track list crosses IPC and the frontend compares serialized track objects. This can become expensive on external/network drives and large collections. Measure idle I/O, scan latency and UI responsiveness with representative collections; then add debounced filesystem events, incremental changes and a slower reconciliation scan. The backend currently caps enumeration at 100,000 tracks and depth eight; surface those limits when reached.

8. **Low: monolithic loading and page state reduce polish. Confirmed structure/build warning.** Production builds emit one approximately 658 kB JavaScript chunk (194 kB gzip). `App.tsx` eagerly imports major pages; the hidden podcast page is also statically imported. Lazy-load infrequent pages/dialogs and measure startup before further optimization. Pages such as Library are conditionally mounted, so their local search/view/filter state resets on navigation. Remember these values for the session, along with scroll position. Also make queue limits visible: Library playback starts at most 500 tracks while restored player queues are capped at 2,000.

**Existing strengths to preserve**

The downloader has meaningful safeguards: argument allowlisting, URL separation from options, output/path validation, disk preflight, attempt identities, independent recovery manifests and post-download verification. File transfers use checked copies; recycling failures do not silently become permanent deletion. Private headers/signed query values are redacted from persisted download data. Playback is authorized through bounded loopback streaming with origin checks and expiring capability URLs. These are code observations backed in part by tests, rather than a claim of comprehensive security assurance.

**Recommended additions**

Effort is relative implementation scope, not a delivery estimate. Priorities assume Kaisu remains a local downloader plus music library.

| Order | Addition | First useful version | Fit / effort |
| --- | --- | --- | --- |
| 1 | Download directly into a playlist | Choose an existing/new library playlist when downloading audio; show pending items and attach each verified file on completion | Connects the two main workflows / medium |
| 2 | Backup and restore | Versioned export/import of playlists, ratings, favorites, settings and listening data; exclude credentials; preview merges and map missing roots | Protects growing personal data / medium |
| 3 | Playlist import | Read local `.m3u`/`.m3u8`, resolve relative paths inside approved roots, preview missing tracks and duplicates | Complements existing export and music-folder import / small–medium |
| 4 | Chapters and bookmarks | Expose source chapters, seek to chapters locally, save timestamp bookmarks; later offer checked chapter selection and splitting | Useful for albums, concerts, lectures and long recordings / medium, larger for splitting |
| 5 | Saved channels/playlists | Save a source and output profile; manually check for new items first, then optionally schedule checks with review-before-download | Gives the download queue recurring value / large |
| 6 | Device export profiles | Select a playlist and target folder; estimate space, export compatible copies plus a relative-path playlist; keep a verified manifest | Extends existing transfer/conversion tools / large |
| 7 | Library health and repair | One view for missing files, unreadable media, incomplete tags and duplicates; batch relocation by selected old/new roots | Builds on current recovery and library tooling / medium |
| 8 | Metadata matching with preview | Suggest artist/album/track corrections, show confidence and exact changes, then apply using the existing verified tag writer | Improves imported collections; requires source choice and consent / large |

Chapter splitting is supported by [yt-dlp](https://github.com/yt-dlp/yt-dlp#post-processing-options), but needs application-level multi-output verification, recovery, history and library handling. It is more than exposing a custom argument. yt-dlp also offers [download archives](https://github.com/yt-dlp/yt-dlp#video-selection), but Kaisu's durable identity should retain its existing output-profile distinction so an audio download does not accidentally suppress a wanted video version.

Smaller product improvements: preserve Library view/filter/scroll state; show which site rule/output profile will apply before download; offer a “keep original audio” choice when compatible; explain that encoding an already lossy source as FLAC does not restore lost quality; show credential-store fallback status in Settings; add a redacted diagnostic export with helper versions, platform and recent job failures.

Application update notifications would be useful alongside helper-tool updates. Fully automatic signed updates are a separate distribution decision: [Tauri's updater](https://v2.tauri.app/plugin/updater/) requires signed update artifacts, and this repository currently builds portable executables with bundling disabled. Keep portable distribution supported if adopting an installer/update channel. CI, native validation and Windows signing were previously deferred by the user according to HANDOFF; this audit does not change that decision.

**Suggested implementation sequence**

1. Fix malformed-state recovery, lookup invalidation, false missing-file state and save-error visibility.
2. Separate durable download records from the recent-history display; add migrations and backup/restore.
3. Ship download-to-playlist plus playlist import as the next cohesive feature release.
4. Benchmark large libraries and external drives; improve incremental scanning where measurements show a need.
5. Add chapter tools or saved-source subscriptions depending on whether long-form playback or recurring downloads matters more to users.

**Verification during this audit**

- `npm test`: 431 tests passed across 40 files.
- `npm run build`: passed TypeScript and production build; large-chunk warning described above.
- `cargo test --locked`: 205 passed, zero failed, one ignored.
- `uv run python -m unittest`: 15 passed.
- `npm audit --json`: zero reported advisories for the installed npm dependency tree at audit time; Rust/Python dependencies were not checked against advisory databases.
- Targeted Chrome runtime checks reproduced stale search results, a stale inspection error on a new batch, and blank rendering from malformed persisted settings.
- `npm run test:ui -- features chrome downloader safety round5 round6 round7 round8 round9 round26`: all ten suites passed, 498 checks total. This closes the specific browser-suite gaps listed in HANDOFF and includes the pre-existing uncommitted round26 suite; the entire UI suite collection was not rerun.
- No application-code changes, native playback validation or exhaustive extractor/site compatibility test was performed.
