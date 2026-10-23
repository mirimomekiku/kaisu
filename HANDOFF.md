# Handoff: audit and downloader hardening (2026-10-23)

State of the repo after one working session: a full audit of Kaisu 0.0.3, the downloader-safety work that was
already in the tree, and a follow-up round that fixed the audit's findings. Nothing new was built beyond that.

## What the app is
Tauri v2 desktop app (Windows and Linux) wrapping yt-dlp and ffmpeg, plus a music library and player, plus a separate
Python Textual terminal app in `tui/`. React 19 / Vite / Tailwind 4 frontend in `desktop/src`; Rust backend in
`desktop/src-tauri/src` (~35 modules; `download.rs` is the core). Version 0.0.3, no CI, Windows exe unsigned. Start with
`README.md` (features), `CONTRIBUTING.md` (build, tests, architecture notes) and `desktop/README.md` (downloader controls).

## What was done
Commits already pushed to `origin/main`:
- `e98b249` fix(links): unknown sites keep host, port and query when comparing URLs.
- `b8a61df` feat(downloads): file-conflict policy (keep both / skip / replace), shared speed and fragment budgets,
  stall watchdog (notice at 30s, timeout at 120s, conversion 1800s), jittered retries and per-site 429 cooldown,
  redaction of signed-link tokens and private headers, duplicate detection by output profile.
- `257eb32` docs: README and `desktop/README.md` for the above.

Follow-up round (this handoff's commits), fixing audit findings 3 to 7:
- **3 Shared constants:** timeout and retry numbers now live in `desktop/testdata/download-validation.json`. Rust
  consts in `download.rs` and `RETRY` in `errors.ts` are tested against it.
- **4 Queue scheduler:** start decisions moved out of the `useDownloads` effect into pure, unit-tested functions in
  `src/lib/queueStart.ts` (`pickStartable`, `resourceGate`). The `draining`/`resources` refs and the manual tick are gone.
- **5 Redaction patterns:** one secret-name list (substring parts plus exact names) shared by `redact.ts` and `net.rs`,
  tightened so `author`, `authority`, `policy_name`, `keyword` and similar are no longer redacted. Table-tested on both sides.
- **6 Media server:** CORS is echoed only to the app's own origins and any other `Origin` gets 403; playback URLs expire
  after six hours idle (every request renews them). No per-token byte cap was added: a leaked URL can read its file once
  anyway, so a cap protects nothing.
- **7 Small items:** `tui/README.md` anchor fixed, poisoned-mutex `unwrap()`s in `tray.rs` replaced, remaining non-test
  `unwrap()`s in `custom_args.rs` and `media_stream.rs` removed. `e2e/.vite-cache` was already git-ignored, so no change.

Deliberately not done (user's choice): CI, native Linux testing, Windows code signing (audit finding 8).

## Verification status
Passed:
- `npx tsc --noEmit` clean; `npx vitest run` 431 tests, 40 files.
- `cargo test`: 202 passed, 0 failed, 1 ignored (after the media-stream and constants changes).
- `npm run test:real:eq:windows` against a rebuilt debug exe: 10/10, including a new check that the app origin is allowed and
  `https://example.com` gets 403. The equalizer works with the restricted CORS.
- `npm run test:ui`: flow, queue, round10 to round25 (except round4's first run) and round3 passed.

Not confirmed, so do these before trusting the round:
- `features` failed twice on a page-navigation timeout in `harness.mjs` (harness/Vite flakiness, not an assertion), so it is
  unverified. `round4` failed once and then passed on rerun.
- `chrome`, `downloader`, `safety`, `round5` to `round9` had not run when the session was stopped. `downloader` and
  `safety` are the ones most relevant to the downloader changes. Run:
  `npm run test:ui -- features chrome downloader safety round5 round6 round7 round8 round9`
  (the whole `test:ui` run takes more than 10 minutes; run it in the background).
- `test:real` and `test:real:playback` (Linux, tauri-driver, ffmpeg) were not run.

## Gotchas
- Only a rebuilt debug exe reflects Rust changes: `npx tauri build --debug --no-bundle` (about 7 minutes). A plain
  `cargo build` exe tries the Vite dev URL.
- The Windows real-window EQ test timed out once on first start and then passed; rerun before treating it as a failure.
- Working copies are LF with `.gitattributes` converting to CRLF, so Git prints "LF will be replaced by CRLF" warnings.
- Commits are authored by `mirimomekiku` only; no Claude co-author trailer was used, at the user's request.

## Suggested next steps
1. Finish the unconfirmed UI suites above and fix anything real.
2. Decide on CI (a Windows and Linux workflow for tsc, vitest, cargo test and `test:ui`) when ready.
3. Native Linux validation of mount identity and process-group cancellation (documented gap in CONTRIBUTING).
4. Code signing for the Windows exe.
