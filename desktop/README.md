# Kaisu desktop

See the [root README](../README.md#desktop-app). Quick start:

```bash
node ../scripts/fetch-binaries.mjs   # once
npm install
npm run tauri dev
```

Downloader controls in **Settings → Downloads** include file conflict handling, a total speed budget, and a total fragment connection budget. Keep both is the default; Skip verifies the existing output before marking it skipped, and Replace explicitly permits overwriting. Output families (media, partials, subtitles, artwork and chapter files) are reserved until verification finishes, including Windows case aliases and canonical folder aliases.

Network budgets reserve equal shares for configured queue slots, so idle slots leave unused bandwidth. Changing the budget restarts active transfers with their compatible partial files. Fragment rate limits are divided across fragment connections. Capped clip transfers and live/unsupported protocols are refused when their downloader cannot enforce the speed limit.

Transfers show a stall notice after 30 seconds without progress and normally time out after two minutes. Deliberately low rate limits receive longer buffer allowances. Conversion has a separate 30-minute inactivity allowance and file-write monitoring; metadata planning and final helper operations also have bounded deadlines. Automatic retries use jitter, coordinate yt-dlp's internal retries, and apply a shared website cooldown for rate-limit errors.

Private custom headers are kept in the OS credential store for settings; without a working credential store they must be entered again after restart. Queue, history, recovery files, logs and command previews omit private header values and recognized signed-link tokens. A restored request that needs those credentials asks for a fresh link and headers instead of silently downloading with changed credentials.

Desktop yt-dlp calls ignore external configuration files, including `yt-dlp.conf` in the output folder. Use Kaisu's settings and validated custom arguments to configure its downloads. Sensitive extractor arguments and referers are also hidden in command previews, errors and download logs.

Moving or copying finished files refuses destination subfolders that are symbolic links or Windows junctions. File writes, staging, renames and cleanup stay relative to an open destination directory. Changing a waiting download's output choices creates a fresh recovery identity and keeps the original recovery record and partial files. Speed-only edits retain compatible recovery; partial files are reused only when the planned streams match the recorded format.

In **Library → song actions → Edit tags → Identify music online**, search MusicBrainz by title and artist, choose a recording and release edition, and review individual tag changes. Cover art can be previewed from the Cover Art Archive. Lookup requires consent and sends the entered metadata and selected release IDs; audio and local paths stay on the computer. This is assisted metadata identification, without audio fingerprinting. Accepted changes populate the editor; **Save** performs the existing verified tag write.

With **YouTube Music selected as the search source**, audio downloads automatically request both a lyrics sidecar and embedded lyrics after LRCLIB consent. Other sources offer a choice of no lyrics, a sidecar, embedding, or both in single and batch downloads, including Simple mode. Timestamped lyrics retain their LRC timestamps inside MP3, M4A, FLAC, Opus, and WAV tags. Synced lyrics save as `.lrc`; plain-only results save as `.txt`. Availability depends on LRCLIB; declining lookup still downloads the audio.
