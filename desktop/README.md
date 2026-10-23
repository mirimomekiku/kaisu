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
